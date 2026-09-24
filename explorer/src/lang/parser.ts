// Recursive-descent parser for the Java subset. Precedence climbs from
// assignment (lowest) to postfix member access and indexing (highest).

import type { AssignOp, BinaryOp, Block, ClassDecl, CompilationUnit, Expr, FieldDecl, MethodDecl, Param, Pos, Stmt } from './ast';
import { SourceError, tokenize, type Token } from './lexer';

const MODIFIERS = new Set(['public', 'private', 'protected', 'final', 'static']);
const ASSIGN_OPS = new Set<string>(['=', '+=', '-=', '*=', '/=', '%=']);

/** Binary operators by precedence level, lowest first. */
const LEVELS: BinaryOp[][] = [['||'], ['&&'], ['==', '!='], ['<', '>', '<=', '>='], ['+', '-'], ['*', '/', '%']];

export function parse(src: string): CompilationUnit {
  return new Parser(tokenize(src)).unit();
}

class Parser {
  private i = 0;

  constructor(private readonly toks: Token[]) {}

  // ------------------------------------------------------------- helpers

  private get tok(): Token {
    return this.toks[this.i];
  }

  private peek(n = 1): Token {
    return this.toks[Math.min(this.i + n, this.toks.length - 1)];
  }

  private is(value: string, t = this.tok): boolean {
    return (t.kind === 'punct' || t.kind === 'keyword') && t.value === value;
  }

  private accept(value: string): boolean {
    if (!this.is(value)) return false;
    this.i++;
    return true;
  }

  private expect(value: string, what = `'${value}'`): Token {
    if (!this.is(value)) throw this.error(`Expected ${what} but found ${this.describe(this.tok)}`);
    return this.toks[this.i++];
  }

  private ident(what = 'a name'): Token {
    if (this.tok.kind !== 'ident') throw this.error(`Expected ${what} but found ${this.describe(this.tok)}`);
    return this.toks[this.i++];
  }

  private describe(t: Token): string {
    return t.kind === 'eof' ? 'the end of the code' : `'${t.value}'`;
  }

  private error(message: string, t: Pos = this.tok): SourceError {
    return new SourceError(message, t.line, t.col);
  }

  private pos(t: Token = this.tok): Pos {
    return { line: t.line, col: t.col };
  }

  private skipModifiers(): Set<string> {
    const mods = new Set<string>();
    while (this.tok.kind === 'keyword' && MODIFIERS.has(this.tok.value)) mods.add(this.toks[this.i++].value);
    return mods;
  }

  // ------------------------------------------------------------- types

  private isTypeStart(t = this.tok): boolean {
    return t.kind === 'ident' || (t.kind === 'keyword' && ['int', 'boolean', 'void', 'var'].includes(t.value));
  }

  private type(): string {
    if (!this.isTypeStart()) throw this.error(`Expected a type but found ${this.describe(this.tok)}`);
    let t = this.toks[this.i++].value;
    while (this.is('[') && this.is(']', this.peek())) {
      this.i += 2;
      t += '[]';
    }
    return t;
  }

  /** Does a local variable declaration (`Type name`) start here? */
  private looksLikeDeclaration(): boolean {
    if (!this.isTypeStart()) return false;
    let j = this.i + 1;
    while (this.is('[', this.toks[j]) && this.is(']', this.toks[j + 1])) j += 2;
    return this.toks[j].kind === 'ident';
  }

  // ------------------------------------------------------------- declarations

  unit(): CompilationUnit {
    const classes: ClassDecl[] = [];
    while (this.tok.kind !== 'eof') {
      this.skipModifiers();
      if (this.is('class') || this.is('record')) classes.push(this.classDecl());
      else throw this.error(`Expected 'class' or 'record' but found ${this.describe(this.tok)}`);
    }
    return { classes };
  }

  private classDecl(): ClassDecl {
    const kw = this.toks[this.i++];
    const name = this.ident('a class name').value;
    const isRecord = kw.value === 'record';
    const components = isRecord ? this.params() : [];
    const cls: ClassDecl = { name, isRecord, components, fields: [], methods: [], ...this.pos(kw) };
    this.expect('{');
    while (!this.accept('}')) {
      if (this.tok.kind === 'eof') throw this.error(`Class ${name} is never closed (missing '}')`);
      this.member(cls);
    }
    return cls;
  }

  private params(): Param[] {
    this.expect('(');
    const out: Param[] = [];
    if (!this.accept(')')) {
      do {
        this.skipModifiers();
        const at = this.pos();
        const type = this.type();
        out.push({ type, name: this.ident('a parameter name').value, ...at });
      } while (this.accept(','));
      this.expect(')');
    }
    return out;
  }

  private member(cls: ClassDecl): void {
    const mods = this.skipModifiers();
    const at = this.pos();
    const isStatic = mods.has('static');
    // Constructor: `Name(`
    if (this.tok.kind === 'ident' && this.tok.value === cls.name && this.is('(', this.peek())) {
      this.i++;
      cls.methods.push(this.methodRest('<init>', 'void', false, true, at));
      return;
    }
    const type = this.type();
    const name = this.ident('a field or method name');
    if (this.is('(')) {
      cls.methods.push(this.methodRest(name.value, type, isStatic, false, at));
      return;
    }
    const field: FieldDecl = { name: name.value, type, isStatic, init: null, ...at };
    if (this.accept('=')) field.init = this.expr();
    this.expect(';');
    cls.fields.push(field);
  }

  private methodRest(name: string, ret: string, isStatic: boolean, isCtor: boolean, at: Pos): MethodDecl {
    const params = this.params();
    const body = this.block();
    const endLine = this.toks[this.i - 1].line;
    return { name, ret, params, isStatic, isCtor, body, endLine, ...at };
  }

  // ------------------------------------------------------------- statements

  private block(): Block {
    const at = this.pos();
    this.expect('{');
    const body: Stmt[] = [];
    while (!this.accept('}')) {
      if (this.tok.kind === 'eof') throw this.error(`This block is never closed (missing '}')`, at);
      body.push(this.stmt());
    }
    return { kind: 'block', body, ...at };
  }

  private stmt(): Stmt {
    const at = this.pos();
    if (this.is('{')) return this.block();
    if (this.accept(';')) return { kind: 'empty', ...at };
    if (this.accept('if')) {
      this.expect('(');
      const cond = this.expr();
      this.expect(')');
      const then = this.stmt();
      return { kind: 'if', cond, then, else: this.accept('else') ? this.stmt() : null, ...at };
    }
    if (this.accept('while')) {
      this.expect('(');
      const cond = this.expr();
      this.expect(')');
      return { kind: 'while', cond, body: this.stmt(), ...at };
    }
    if (this.accept('for')) return this.forStmt(at);
    if (this.accept('return')) {
      const value = this.is(';') ? null : this.expr();
      this.expect(';');
      return { kind: 'return', value, ...at };
    }
    if (this.accept('break')) {
      this.expect(';');
      return { kind: 'break', ...at };
    }
    if (this.accept('continue')) {
      this.expect(';');
      return { kind: 'continue', ...at };
    }
    if (this.is('else')) throw this.error(`'else' without a matching 'if'`);
    const s = this.simpleStmt();
    this.expect(';');
    return s;
  }

  /** A declaration or an expression statement, without the final ';'. */
  private simpleStmt(): Stmt {
    const at = this.pos();
    this.skipModifiers(); // `final int x = ...`
    if (this.looksLikeDeclaration()) {
      const type = this.type();
      const name = this.ident('a variable name').value;
      const init = this.accept('=') ? this.expr() : null;
      return { kind: 'local', type, name, init, ...at };
    }
    const expr = this.expr();
    if (!['assign', 'incdec', 'call', 'new'].includes(expr.kind))
      throw this.error('This is not a statement: it computes a value but does nothing with it', at);
    return { kind: 'expr', expr, ...at };
  }

  private forStmt(at: Pos): Stmt {
    this.expect('(');
    const init: Stmt[] = [];
    if (!this.is(';'))
      do init.push(this.simpleStmt());
      while (this.accept(','));
    this.expect(';');
    const cond = this.is(';') ? null : this.expr();
    this.expect(';');
    const update: Expr[] = [];
    if (!this.is(')'))
      do update.push(this.expr());
      while (this.accept(','));
    this.expect(')');
    return { kind: 'for', init, cond, update, body: this.stmt(), ...at };
  }

  // ------------------------------------------------------------- expressions

  expr(): Expr {
    const left = this.binary(0);
    if (this.tok.kind === 'punct' && ASSIGN_OPS.has(this.tok.value)) {
      const opTok = this.toks[this.i++];
      if (!['name', 'field', 'index'].includes(left.kind)) throw this.error('You can only assign to a variable, a field or an array element', opTok);
      const value = this.expr(); // right-associative
      return { kind: 'assign', op: opTok.value as AssignOp, target: left, value, line: opTok.line, col: opTok.col };
    }
    return left;
  }

  private binary(level: number): Expr {
    if (level === LEVELS.length) return this.unary();
    let left = this.binary(level + 1);
    while (this.tok.kind === 'punct' && (LEVELS[level] as string[]).includes(this.tok.value)) {
      const op = this.toks[this.i++];
      const right = this.binary(level + 1);
      left = { kind: 'binary', op: op.value as BinaryOp, left, right, line: op.line, col: op.col };
    }
    return left;
  }

  private unary(): Expr {
    const at = this.pos();
    if (this.accept('-')) {
      const e = this.unary();
      // javac folds negative literals: `-5` is a single constant.
      if (e.kind === 'int') return { ...e, value: -e.value | 0, ...at };
      return { kind: 'unary', op: '-', expr: e, ...at };
    }
    if (this.accept('!')) return { kind: 'unary', op: '!', expr: this.unary(), ...at };
    if (this.is('++') || this.is('--')) {
      const op = this.toks[this.i++].value as '++' | '--';
      return { kind: 'incdec', op, prefix: true, target: this.assignable(this.unary()), ...at };
    }
    return this.postfix(this.primary());
  }

  private assignable(e: Expr): Expr {
    if (!['name', 'field', 'index'].includes(e.kind)) throw this.error('++ and -- only work on variables, fields and array elements', e);
    return e;
  }

  private postfix(e: Expr): Expr {
    for (;;) {
      const at = this.pos();
      if (this.accept('.')) {
        const name = this.ident('a field or method name').value;
        e = this.is('(') ? { kind: 'call', target: e, name, args: this.args(), ...at } : { kind: 'field', obj: e, name, ...at };
      } else if (this.accept('[')) {
        const index = this.expr();
        this.expect(']');
        e = { kind: 'index', array: e, index, ...at };
      } else if (this.is('++') || this.is('--')) {
        const op = this.toks[this.i++].value as '++' | '--';
        e = { kind: 'incdec', op, prefix: false, target: this.assignable(e), ...at };
      } else return e;
    }
  }

  private args(): Expr[] {
    this.expect('(');
    const out: Expr[] = [];
    if (!this.accept(')')) {
      do out.push(this.expr());
      while (this.accept(','));
      this.expect(')');
    }
    return out;
  }

  private primary(): Expr {
    const t = this.tok;
    const at = this.pos();
    if (t.kind === 'int') {
      this.i++;
      if (Number(t.value) > 2147483647) throw this.error(`The number ${t.value} is too large for an int`, t);
      return { kind: 'int', value: Number(t.value), ...at };
    }
    if (t.kind === 'string') {
      this.i++;
      return { kind: 'string', value: t.value, ...at };
    }
    if (this.accept('true')) return { kind: 'bool', value: true, ...at };
    if (this.accept('false')) return { kind: 'bool', value: false, ...at };
    if (this.accept('null')) return { kind: 'null', ...at };
    if (this.accept('this')) return { kind: 'this', ...at };
    if (this.accept('(')) {
      const e = this.expr();
      this.expect(')');
      return e;
    }
    if (this.accept('new')) {
      const elem = this.type();
      if (this.accept('[')) {
        const length = this.expr();
        this.expect(']');
        return { kind: 'newArray', elem, length, ...at };
      }
      return { kind: 'new', cls: elem, args: this.args(), ...at };
    }
    if (t.kind === 'ident') {
      this.i++;
      if (this.is('(')) return { kind: 'call', target: null, name: t.value, args: this.args(), ...at };
      return { kind: 'name', name: t.value, ...at };
    }
    throw this.error(`Expected an expression but found ${this.describe(t)}`);
  }
}
