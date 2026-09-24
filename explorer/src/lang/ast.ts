// The syntax tree of the Java subset. Types are plain strings: 'int',
// 'boolean', 'void', 'String', a class name, or any of those followed by '[]'.

export interface Pos {
  line: number;
  col: number;
}

export interface Param extends Pos {
  name: string;
  type: string;
}

export interface FieldDecl extends Pos {
  name: string;
  type: string;
  isStatic: boolean;
  init: Expr | null;
}

export interface MethodDecl extends Pos {
  name: string;
  /** Return type; 'void' for constructors. */
  ret: string;
  params: Param[];
  isStatic: boolean;
  isCtor: boolean;
  body: Block;
  /** Line of the closing brace: where the implicit `return` goes. */
  endLine: number;
}

export interface ClassDecl extends Pos {
  name: string;
  isRecord: boolean;
  /** Record components (empty for classes). */
  components: Param[];
  fields: FieldDecl[];
  methods: MethodDecl[];
}

export interface CompilationUnit {
  classes: ClassDecl[];
}

// ------------------------------------------------------------------ statements

export type Stmt =
  | Block
  | ({ kind: 'local'; type: string; name: string; init: Expr | null } & Pos)
  | ({ kind: 'if'; cond: Expr; then: Stmt; else: Stmt | null } & Pos)
  | ({ kind: 'while'; cond: Expr; body: Stmt } & Pos)
  | ({ kind: 'for'; init: Stmt[]; cond: Expr | null; update: Expr[]; body: Stmt } & Pos)
  | ({ kind: 'return'; value: Expr | null } & Pos)
  | ({ kind: 'expr'; expr: Expr } & Pos)
  | ({ kind: 'break' } & Pos)
  | ({ kind: 'continue' } & Pos)
  | ({ kind: 'empty' } & Pos);

export interface Block extends Pos {
  kind: 'block';
  body: Stmt[];
}

// ------------------------------------------------------------------ expressions

export type BinaryOp = '+' | '-' | '*' | '/' | '%' | '<' | '>' | '<=' | '>=' | '==' | '!=' | '&&' | '||';
export type AssignOp = '=' | '+=' | '-=' | '*=' | '/=' | '%=';

export type Expr =
  | ({ kind: 'int'; value: number } & Pos)
  | ({ kind: 'bool'; value: boolean } & Pos)
  | ({ kind: 'null' } & Pos)
  | ({ kind: 'string'; value: string } & Pos)
  | ({ kind: 'name'; name: string } & Pos)
  | ({ kind: 'this' } & Pos)
  | ({ kind: 'binary'; op: BinaryOp; left: Expr; right: Expr } & Pos)
  | ({ kind: 'unary'; op: '-' | '!'; expr: Expr } & Pos)
  | ({ kind: 'assign'; op: AssignOp; target: Expr; value: Expr } & Pos)
  | ({ kind: 'incdec'; op: '++' | '--'; prefix: boolean; target: Expr } & Pos)
  | ({ kind: 'call'; target: Expr | null; name: string; args: Expr[] } & Pos)
  | ({ kind: 'field'; obj: Expr; name: string } & Pos)
  | ({ kind: 'index'; array: Expr; index: Expr } & Pos)
  | ({ kind: 'new'; cls: string; args: Expr[] } & Pos)
  | ({ kind: 'newArray'; elem: string; length: Expr } & Pos);
