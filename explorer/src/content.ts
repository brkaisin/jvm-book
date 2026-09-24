// Everything the explorer *says*: one entry per clickable thing in the world,
// plus the guided tour. Links are relative to /explorer/index.html.

export type AreaId = 'outside' | 'loading' | 'memory' | 'threads' | 'engine' | 'gc' | 'beyond';

/** Things a panel button can ask the simulation to do. */
export type ActionId = 'gcNow' | 'toggleGc' | 'spawnVthreads' | 'hotMethod' | 'deopt';

export interface Hotspot {
  area: AreaId;
  title: string;
  /** How to read it in the 3D world: shapes, colours, motion. */
  see: string;
  /** Short HTML explanation. */
  summary: string;
  /** Optional HTML diagram or snippet shown under the summary. */
  extra?: string;
  /** One "did you know" line (HTML). */
  fact?: string;
  /** [label, href] pairs into the book. */
  links: [string, string][];
  actions?: [string, ActionId][];
}

export interface TourStep {
  id: HotspotId;
  say: string;
  action?: ActionId;
}

const P1 = '../part-1-the-big-picture/';
const P2 = '../part-2-jvm-architecture/';
const P3 = '../part-3-memory-and-gc/';
const P4 = '../part-4-type-system/';
const P5 = '../part-5-concurrency/';
const P6 = '../part-6-performance/';
const P7 = '../part-7-ecosystem/';

export const AREAS: Record<AreaId, { label: string; color: string }> = {
  outside: { label: 'Before the JVM', color: '#9aa7b8' },
  loading: { label: 'Class loading', color: '#ffd166' },
  memory: { label: 'Memory', color: '#4cc9f0' },
  threads: { label: 'Threads', color: '#b388ff' },
  engine: { label: 'Execution engine', color: '#ff9f43' },
  gc: { label: 'Garbage collection', color: '#c8f7ff' },
  beyond: { label: 'Around the JVM', color: '#ff6b9d' },
};

// A tiny byte-bar diagram, used in a couple of panels.
const bar = (cells: [string, number, string?][]): string =>
  `<div class="bytebar">${cells
    .map(([label, w, cls]) => `<span class="${cls || ''}" style="flex:${w}">${label}</span>`)
    .join('')}</div>`;

export const HOTSPOTS = {
  jvm: {
    area: 'beyond',
    title: 'The Java Virtual Machine',
    see: 'The glowing dome is the boundary of the JVM process. Everything inside it is managed by the JVM; the source code, the compiler and native libraries stay outside.',
    summary:
      'You are standing inside a running JVM. It is a <b>specification</b> (an abstract machine that executes bytecode) and a family of implementations; the one you almost certainly run is <b>HotSpot</b>, from OpenJDK. It loads classes, manages memory, schedules threads and turns bytecode into machine code while your program runs.',
    fact: 'The same <code>.class</code> file runs unchanged on Linux, macOS and Windows, on x64 and ARM. That is the whole point of the dome you see around you.',
    links: [
      ['Ch. 1 — Why the JVM exists', P1 + '01-why-the-jvm-exists.html#what-the-jvm-actually-does'],
      ['Ch. 3 — A timeline of the JVM', P1 + '03-timeline.html'],
    ],
  },

  // ---------------------------------------------------------------- outside
  source: {
    area: 'outside',
    title: 'Your source code',
    see: 'A Scala source file floating outside the dome: white particles carry it into the compiler.',
    summary:
      'Java, Scala, Kotlin, Clojure… The JVM never sees any of it. Source files live <b>outside</b> the machine; only the compiled bytecode crosses the boundary.',
    fact: 'Scala and Java can produce almost identical bytecode for the same program. At runtime, the JVM does not care which language you wrote.',
    links: [
      ['Ch. 2 — From source code to execution', P1 + '02-from-source-to-execution.html#the-journey-of-your-code'],
      ['Ch. 25 — The JVM language ecosystem', P7 + '25-language-ecosystem.html'],
    ],
  },
  compiler: {
    area: 'outside',
    title: 'javac, scalac, kotlinc',
    see: 'The spinning prism is the compiler. Source goes in on the left, gold class files come out on the right.',
    summary:
      'The language compiler turns source into <b>bytecode</b>, not machine code. It does surprisingly little optimisation: the heavy lifting is left to the JIT inside the JVM, which knows how the program actually behaves.',
    fact: '<code>scalac</code> does a lot more work than <code>javac</code> (traits, pattern matching, closures) but the output is still plain class files.',
    links: [
      ['Ch. 2 — Step 1: compilation', P1 + '02-from-source-to-execution.html#step-1-compilation--source-to-bytecode'],
      ['Ch. 2 — scalac vs javac', P1 + '02-from-source-to-execution.html#the-difference-between-scalac-and-javac'],
    ],
  },
  classfile: {
    area: 'outside',
    title: 'The .class file',
    see: 'Gold cubes stamped CAFE BABE are class files. Watch one fly through the loader rings, the green verifier gate, and up into Metaspace.',
    summary:
      'Every class file starts with the magic number <code>0xCAFEBABE</code>, then a version, a <b>constant pool</b> (names, strings, method references), the fields, and the methods with their bytecode. Classes travel in JARs, which are just ZIP files.',
    extra: bar([
      ['CAFEBABE', 2, 'hl'],
      ['version', 1.4],
      ['constant pool', 4],
      ['fields', 2],
      ['methods', 3],
      ['attrs', 1.3],
    ]),
    fact: 'Since JDK 24, <code>java.lang.classfile</code> is a standard API to read and write class files.',
    links: [
      ['Ch. 5 — Anatomy of a class file', P2 + '05-bytecode.html#anatomy-of-a-class-file'],
      ['Ch. 5 — The constant pool', P2 + '05-bytecode.html#the-constant-pool'],
    ],
  },

  // ---------------------------------------------------------------- loading
  classloaders: {
    area: 'loading',
    title: 'The class loader subsystem',
    see: 'Three nested rings: gold Bootstrap in the middle, teal Platform, blue Application outside. When a class arrives, the rings flash from the inside out: the request goes to the parent first.',
    summary:
      'Three built-in loaders, nested like these rings: the <b>Bootstrap</b> loader (core <code>java.base</code>, gold), the <b>Platform</b> loader, and the <b>Application</b> loader (your classpath). A loader first asks its parent; only if the parent cannot find the class does it try itself. That is <b>parent delegation</b>.',
    fact: 'Loading is lazy: a class is loaded the first time it is actually needed, not when the program starts.',
    links: [
      ['Ch. 4 — The three built-in class loaders', P2 + '04-class-loaders.html#the-three-built-in-class-loaders'],
      ['Ch. 4 — Parent delegation', P2 + '04-class-loaders.html#the-parent-delegation-model'],
    ],
  },
  verifier: {
    area: 'loading',
    title: 'Linking: verify, prepare, resolve',
    see: 'The green grid with a scanning line is the verifier gate every class file must cross before its code can run.',
    summary:
      'Before a class runs, the <b>verifier</b> scans its bytecode: types on the operand stack must match, jumps must land on real instructions, no stack underflow. Then the JVM <b>prepares</b> static fields and lazily <b>resolves</b> symbolic references into real ones. Finally the static initialiser runs.',
    fact: 'Verification is why a malicious class file cannot forge pointers: the JVM never trusts bytecode it did not check.',
    links: [
      ['Ch. 2 — Bytecode verification', P1 + '02-from-source-to-execution.html#step-4-bytecode-verification--trust-but-verify'],
      ['Ch. 4 — The class loading lifecycle', P2 + '04-class-loaders.html#the-class-loading-lifecycle'],
    ],
  },
  modules: {
    area: 'loading',
    title: 'Modules',
    see: 'Hexagon tiles on the floor, one per module: gold java.base in the middle, teal JDK modules, blue application modules.',
    summary:
      'Since Java 9 the JDK itself is split into modules (<code>java.base</code>, <code>java.sql</code>…). A module says what it <b>requires</b> and what it <b>exports</b>; everything else is strongly encapsulated, even from reflection.',
    fact: 'JDK 25 added <code>import module java.base;</code>, importing every exported package of a module in one line.',
    links: [
      ['Ch. 23 — The module system', P7 + '23-module-system.html#the-module-system-project-jigsaw'],
      ['Ch. 23 — Integrity by default', P7 + '23-module-system.html#integrity-by-default'],
    ],
  },
  aotcache: {
    area: 'loading',
    title: 'The AOT cache (Project Leyden)',
    see: 'The gold crate is the AOT cache from a training run. Its slow gold streams pre-fill Metaspace (classes) and the code cache (profiles, compiled code).',
    summary:
      'Do a <b>training run</b>, and the JVM saves what it learned: classes already loaded and linked (JDK 24), method profiles for the JIT (JDK 25), and soon compiled code. Production runs start from this crate instead of from scratch.',
    extra:
      '<pre class="snip">java -XX:AOTCacheOutput=app.aot -jar app.jar   # train\njava -XX:AOTCache=app.aot -jar app.jar         # run</pre>',
    fact: 'Spring PetClinic started 42% faster with just the class part of the cache.',
    links: [
      ['Ch. 20 — Project Leyden: the AOT cache', P6 + '20-graalvm.html#project-leyden-the-aot-cache'],
      ['Ch. 7 — The AOT cache', P2 + '07-execution-engine.html#the-aot-cache-project-leyden'],
    ],
  },

  // ---------------------------------------------------------------- memory
  metaspace: {
    area: 'memory',
    title: 'Metaspace',
    see: 'Floating crystals, one per class, coloured by the loader that loaded it (gold, teal, blue). Faint ones are not loaded yet; they light up as classes arrive. The blue stream leaving it is bytecode going to the interpreter.',
    summary:
      'Where <b>class metadata</b> lives: one crystal per loaded class, holding its layout, method bytecode, constant pool and vtable. It is native memory, outside the heap, and grows as classes are loaded. Every object in the heap points back here to say what class it is.',
    fact: 'Before Java 8 this was the fixed-size PermGen, famous for <code>OutOfMemoryError: PermGen space</code>.',
    links: [
      ['Ch. 6 — Metaspace', P2 + '06-runtime-data-areas.html#the-method-area--metaspace--where-class-metadata-lives'],
      ['Ch. 4 — Class unloading', P2 + '04-class-loaders.html#class-unloading'],
    ],
  },
  heap: {
    area: 'memory',
    title: 'The heap',
    see: "The big grid is the heap: 60 regions. Tile colour = the region's role. Each small cube on a tile is one object; grey cubes are garbage nobody points to any more.",
    summary:
      'The one memory area shared by every thread: all objects live here. With <b>G1</b>, the default collector, the heap is cut into equal-sized <b>regions</b>, each playing one role at a time: <span class="k eden">Eden</span>, <span class="k surv">Survivor</span>, <span class="k old">Old</span> or <span class="k hum">Humongous</span>. Watch them change as the program runs.',
    fact: 'Size it with <code>-Xms</code>/<code>-Xmx</code>, or in containers with <code>-XX:MaxRAMPercentage</code>.',
    links: [
      ['Ch. 6 — The heap', P2 + '06-runtime-data-areas.html#the-heap--where-objects-live'],
      ['Ch. 10 — G1 regions', P3 + '10-gc-tour.html#g1-garbage-first--the-default'],
    ],
  },
  eden: {
    area: 'memory',
    title: 'Eden: where objects are born',
    see: 'Cyan tiles are Eden regions. New cubes pop into them constantly (the cyan particles coming from the threads are allocations).',
    summary:
      'Every <code>new</code> lands in an Eden region. Each thread has its own slice (a <b>TLAB</b>), so allocating is just bumping a pointer, no locking. Most objects die very young: the grey ones you see are already garbage, nobody points to them any more.',
    fact: 'This is the <b>weak generational hypothesis</b>, and the whole generational design is built on it.',
    links: [
      ['Ch. 6 — Young generation', P2 + '06-runtime-data-areas.html#the-heap--where-objects-live'],
      ['Ch. 9 — Generational collection', P3 + '09-gc-fundamentals.html#generational-collection-putting-it-together'],
    ],
  },
  survivor: {
    area: 'memory',
    title: 'Survivor regions',
    see: 'Lime tiles are Survivor regions. After each young collection, the surviving cubes arc over from Eden and land here.',
    summary:
      'Objects still alive after a young collection are <b>copied</b> here, and their age (stored in the header) goes up by one. Copying compacts them for free: the Eden regions they left are entirely empty again.',
    fact: 'The age field is 4 bits, so an object can survive at most 15 young collections before it must be promoted.',
    links: [
      ['Ch. 9 — The core algorithms', P3 + '09-gc-fundamentals.html#the-core-algorithms'],
      ['Ch. 8 — The mark word (GC age)', P3 + '08-object-layout.html#the-mark-word'],
    ],
  },
  old: {
    area: 'memory',
    title: 'Old regions',
    see: 'Pink tiles are Old regions: cubes that survived several collections end up here, and stay until a mixed collection.',
    summary:
      'Objects that survived enough collections are <b>promoted</b> (tenured) into Old regions: caches, sessions, long-lived state. G1 cleans them up gradually in <b>mixed collections</b>, picking the regions with the most garbage first.',
    fact: '"Garbage first" is literally where G1 gets its name.',
    links: [
      ['Ch. 6 — Old generation', P2 + '06-runtime-data-areas.html#the-heap--where-objects-live'],
      ['Ch. 10 — G1', P3 + '10-gc-tour.html#g1-garbage-first--the-default'],
    ],
  },
  humongous: {
    area: 'memory',
    title: 'A humongous object',
    see: 'The big gold block spanning two regions is a single huge array: too big for a normal region.',
    summary:
      'An object at least half a region big (a huge array, typically) gets its own contiguous run of <b>humongous regions</b>. Allocating them is expensive and they are only reclaimed under specific conditions.',
    fact: 'Frequent humongous allocations are a classic G1 performance problem; the fix is often a larger <code>-XX:G1HeapRegionSize</code>.',
    links: [
      ['Ch. 10 — G1 regions', P3 + '10-gc-tour.html#g1-garbage-first--the-default'],
      ['Ch. 11 — A GC case study', P3 + '11-gc-tuning.html#example-diagnosing-a-gc-issue'],
    ],
  },
  object: {
    area: 'memory',
    title: 'An object',
    see: 'The highlighted cube is one object. The white beam is its class pointer, going up to its class crystal in Metaspace.',
    summary:
      'Every object starts with a <b>header</b>. On JDK 27 it is a single 8-byte word (compact headers, Project Lilliput): a 22-bit class id pointing into Metaspace, the identity hash, the GC age and lock bits. Then come the fields, sorted by size, padded to 8 bytes.',
    extra: bar([
      ['class id', 22, 'hl'],
      ['hash', 31],
      ['V', 4],
      ['age', 4, 'hl2'],
      ['·', 1],
      ['lk', 2],
    ]) + '<div class="bytecap">the 64-bit compact header, to scale</div>',
    fact: 'An empty <code>new Object()</code> is now 8 bytes, half of what it was before JDK 27.',
    links: [
      ['Ch. 8 — Object layout in memory', P3 + '08-object-layout.html#what-does-an-object-actually-look-like'],
      ['Ch. 8 — Project Lilliput', P3 + '08-object-layout.html#project-lilliput-from-experiment-to-default'],
    ],
  },
  directmem: {
    area: 'memory',
    title: 'Direct (off-heap) memory',
    see: 'The three cyan slabs outside the heap grid: buffers the JVM hands out but the garbage collector never touches.',
    summary:
      'Memory the JVM hands out but the GC does not manage: <code>ByteBuffer.allocateDirect</code>, memory-mapped files, and FFM <code>Arena</code>s. Perfect for I/O and native code, because nothing moves it around.',
    fact: 'It does not count in <code>-Xmx</code>, a classic surprise when a container gets OOM-killed.',
    links: [
      ['Ch. 6 — Direct memory', P2 + '06-runtime-data-areas.html#direct-memory-off-heap'],
      ['Ch. 21 — Native memory tracking', P6 + '21-monitoring.html#native-memory-tracking'],
    ],
  },
  valhalla: {
    area: 'memory',
    title: 'Valhalla: flattening (preview in JDK 28)',
    see: 'Two ways to store five points. Back row: an array of references (grey) pointing at separate objects, each with a pink header. Front row: the same data flattened, no pointers, no headers.',
    summary:
      'Today a <code>Point[]</code> is an array of <b>pointers</b> to objects scattered around the heap (left). <b>Value objects</b> give up identity, so the JVM may lay them out <b>flat</b>, inline, with no headers (right): less memory, and no pointer chasing.',
    fact: 'Codes like a class, works like an int.',
    links: [
      ['Ch. 14 — Value objects and Valhalla', P4 + '14-value-types-valhalla.html#the-problem-everything-is-a-pointer'],
      ['Ch. 14 — How the JVM uses the freedom', P4 + '14-value-types-valhalla.html#how-the-jvm-uses-the-freedom'],
    ],
  },

  // ---------------------------------------------------------------- threads
  threads: {
    area: 'threads',
    title: 'Platform threads and their stacks',
    see: 'Each purple-based tower is a platform thread; each slab in the tower is a stack frame (bottom = oldest call, top = the method running now). Dashed lines go down to the CPU core running the thread.',
    summary:
      'Each tower is a platform thread, mapped <b>1:1</b> to an OS thread (see the beams going down to the CPU). Each has its own private <b>stack</b> of frames that grows on calls and shrinks on returns. Frames glow by how their method runs: <span class="k interp">interpreted</span>, <span class="k c1">C1</span> or <span class="k c2">C2</span> code.',
    fact: 'Stack memory is not garbage collected: a frame disappears the instant its method returns.',
    links: [
      ['Ch. 15 — Platform threads', P5 + '15-threads.html#platform-threads-a-11-mapping'],
      ['Ch. 6 — The stack', P2 + '06-runtime-data-areas.html#the-stack--per-thread-per-method'],
    ],
  },
  frame: {
    area: 'threads',
    title: 'A stack frame',
    see: 'A slab in a thread tower. Its colour says how its method runs right now: blue = interpreted, green = C1 code, orange = C2 code. The top slab is the method executing.',
    summary:
      'One frame per method call: an array of <b>local variables</b> (with <code>this</code> in slot 0), an <b>operand stack</b> that bytecode pushes and pops, and a pointer to the class’s constant pool. <code>iadd</code> pops two ints and pushes their sum: the JVM is a stack machine.',
    extra: bar([
      ['locals [this, a, b]', 3, 'hl'],
      ['operand stack', 3, 'hl2'],
      ['frame data', 2],
    ]),
    fact: 'Recurse too deep and you hit <code>StackOverflowError</code>; <code>-Xss</code> sets the stack size.',
    links: [
      ['Ch. 6 — What’s in a stack frame', P2 + '06-runtime-data-areas.html#the-stack--per-thread-per-method'],
      ['Ch. 5 — Stack-based architecture', P2 + '05-bytecode.html#stack-based-architecture'],
    ],
  },
  pc: {
    area: 'threads',
    title: 'The PC register',
    see: 'The small tag above each tower: the current bytecode offset (pc) and the method on top of the stack.',
    summary:
      'Each thread has a tiny <b>program counter</b>: the offset of the bytecode instruction it is executing right now in its current method. The ticking number above each tower is its PC.',
    fact: 'While a thread runs a native method, its PC is undefined.',
    links: [['Ch. 6 — The PC register', P2 + '06-runtime-data-areas.html#the-pc-register--where-am-i']],
  },
  nativestack: {
    area: 'threads',
    title: 'The native method stack',
    see: 'The dark hexagonal base of each tower: the part of the thread stack used by native code.',
    summary:
      'When Java calls C code (JNI or the FFM API) that code needs an ordinary C stack. In HotSpot, Java frames and native frames share the same thread stack, drawn here as the dark base of each tower.',
    fact: 'A crash in native code takes the whole JVM down with it: no exception, just an <code>hs_err_pid.log</code>.',
    links: [['Ch. 6 — The native method stack', P2 + '06-runtime-data-areas.html#the-native-method-stack']],
  },
  vthreads: {
    area: 'threads',
    title: 'Virtual threads',
    see: 'The small violet lights. Circling = waiting in the scheduler queue; big and bright on top of a carrier = running; dim, sitting on the heap = parked, their frames saved as heap objects.',
    summary:
      'The swarm of little lights: <b>virtual threads</b>, managed by the JVM, not the OS. Runnable ones queue in the scheduler; running ones are <b>mounted</b> on a carrier; when one blocks on I/O it unmounts and its frames are saved as <b>stack chunks</b> in the heap, freeing the carrier for someone else.',
    fact: 'A million virtual threads fit easily in memory. A million OS threads do not.',
    links: [
      ['Ch. 18 — How virtual threads work', P5 + '18-virtual-threads.html#how-virtual-threads-work'],
      ['Ch. 18 — Structured concurrency', P5 + '18-virtual-threads.html#structured-concurrency-preview-in-27'],
    ],
    actions: [['Spawn 64 virtual threads', 'spawnVthreads']],
  },
  carriers: {
    area: 'threads',
    title: 'Carrier threads',
    see: 'The two towers on the right with lighter bases are carrier threads. Whatever virtual thread sits on top is the one they are running; its frames are the tower.',
    summary:
      'A small <code>ForkJoinPool</code> of ordinary platform threads, about one per core. They carry whichever virtual thread is mounted on them. Since Java 24, even <code>synchronized</code> no longer pins a virtual thread to its carrier.',
    fact: 'The JFR event <code>jdk.VirtualThreadPinned</code> tells you when one still gets stuck.',
    links: [
      ['Ch. 18 — Pinning (mostly solved)', P5 + '18-virtual-threads.html#pinning-mostly-solved'],
      ['Ch. 17 — Thread pools', P5 + '17-juc-toolbox.html#thread-pools-and-executors'],
    ],
  },

  // ---------------------------------------------------------------- engine
  interpreter: {
    area: 'engine',
    title: 'The interpreter',
    see: 'The blue sphere with a scrolling ribbon of bytecode instructions. The blue stream feeding it comes from Metaspace; a green spark leaving it means a method got hot enough for C1.',
    summary:
      'Every method starts life here (tier 0). The template interpreter reads bytecode one instruction at a time (the ribbon) and jumps to a pre-generated snippet of machine code for each one. It is slow-ish but starts instantly, and it <b>counts</b> calls and loops to find hot code.',
    fact: 'HotSpot is named after exactly this: find the hot spots, compile only those.',
    links: [
      ['Ch. 7 — The interpreter', P2 + '07-execution-engine.html#the-interpreter'],
      ['Ch. 5 — Your first disassembly', P2 + '05-bytecode.html#your-first-bytecode-disassembly'],
    ],
  },
  c1: {
    area: 'engine',
    title: 'C1, the quick compiler',
    see: 'The green crystal. Green sparks arrive from the interpreter (a method got warm), then fly on to the code cache when compiled.',
    summary:
      'Once a method is warm (about 200 calls), <b>C1</b> compiles it quickly, with light optimisation and <b>profiling</b> built in (tier 3): which types show up, which branches are taken. That profile is the fuel for C2.',
    fact: 'Run with <code>-XX:+PrintCompilation</code> to watch methods climb the tiers live.',
    links: [
      ['Ch. 7 — Tiered compilation', P2 + '07-execution-engine.html#tiered-compilation'],
      ['Ch. 19 — Tiered compilation recap', P6 + '19-jit-deep-dive.html#a-quick-recap-tiered-compilation'],
    ],
    actions: [['Heat up a method', 'hotMethod']],
  },
  c2: {
    area: 'engine',
    title: 'C2, the optimising compiler',
    see: 'The orange core with orbiting rings. Orange sparks arrive from C1 when a method gets really hot; the rings spin faster while it compiles.',
    summary:
      'Really hot methods (thousands of calls) are recompiled by <b>C2</b> (tier 4) using the profile: aggressive <b>inlining</b>, <b>escape analysis</b> (objects that never escape are not even allocated), loop unrolling, and <b>speculation</b> on what the profile says is likely.',
    fact: 'Inlining is “the king of optimisations”: it opens the door to almost all the others.',
    links: [
      ['Ch. 19 — Method inlining', P6 + '19-jit-deep-dive.html#method-inlining-the-king-of-optimizations'],
      ['Ch. 19 — Escape analysis', P6 + '19-jit-deep-dive.html#escape-analysis'],
    ],
    actions: [['Heat up a method', 'hotMethod']],
  },
  deopt: {
    area: 'engine',
    title: 'Deoptimisation',
    see: 'A red spark flying from C2 back to the interpreter, and a code-cache block turning red: compiled code was thrown away.',
    summary:
      'C2 bets on the profile: “this call site only ever sees <code>Circle</code>”. When a <code>Square</code> shows up, the bet is lost: the compiled code hits an <b>uncommon trap</b>, is thrown away, and the method falls back to the interpreter (the red spark) to be profiled and compiled again.',
    fact: 'That is why <code>PrintCompilation</code> sometimes says “made not entrant”.',
    links: [
      ['Ch. 7 — Deoptimization', P2 + '07-execution-engine.html#deoptimization'],
      ['Ch. 19 — Speculation and deopt', P6 + '19-jit-deep-dive.html#speculative-optimization-and-deoptimization'],
    ],
    actions: [['Break a speculation', 'deopt']],
  },
  codecache: {
    area: 'engine',
    title: 'The code cache',
    see: "The vault of blocks, one per compiled method. Back row = JVM stubs, middle rows = C1 code (green), front rows = C2 code (orange). Blinking red blocks are 'not entrant', about to be removed.",
    summary:
      'Where the JIT puts the machine code it produces, one block per compiled method (an <b>nmethod</b>), coloured by tier: <span class="k c1">C1</span> or <span class="k c2">C2</span>. It is native memory, split into segments for JVM internals, profiled and fully optimised code.',
    fact: 'If it fills up, the JIT stops compiling and your app silently slows down. Check it with <code>jcmd &lt;pid&gt; Compiler.codecache</code>.',
    links: [['Ch. 6 — The code cache', P2 + '06-runtime-data-areas.html#the-code-cache--where-compiled-code-lives']],
  },

  // ---------------------------------------------------------------- gc
  gc: {
    area: 'gc',
    title: 'The garbage collector',
    see: 'The white ring drone is the garbage collector. During a collection its sweep plane crosses the heap: grey (dead) cubes vanish, live ones flash white, then fly to their new region. With G1, the thread towers freeze in ice meanwhile.',
    summary:
      'The GC starts from the <b>roots</b> (thread stacks, static fields), follows every reference, and reclaims whatever it could not reach. With <b>G1</b>, the default on every machine since JDK 27, a young collection is a short <b>stop-the-world</b> pause: watch the threads freeze at a safepoint while live objects are copied out of Eden.',
    fact: 'Switch to ZGC below: it does almost everything, even moving objects, while your threads keep running.',
    links: [
      ['Ch. 9 — GC fundamentals', P3 + '09-gc-fundamentals.html#gc-roots-where-the-trace-starts'],
      ['Ch. 10 — A tour of the collectors', P3 + '10-gc-tour.html#choosing-a-garbage-collector'],
      ['Ch. 9 — Safepoints', P3 + '09-gc-fundamentals.html#safepoints-where-the-jvm-can-pause-you'],
    ],
    actions: [
      ['Collect now', 'gcNow'],
      ['Toggle G1 / ZGC', 'toggleGc'],
    ],
  },

  // ---------------------------------------------------------------- beyond
  cpu: {
    area: 'beyond',
    title: 'Cores, caches, and the memory model',
    see: 'Under the glass floor: a CPU die with one core per thread (dashed lines come down from the towers) and a shared cache bus. Particles are cache traffic.',
    summary:
      'Under the floor: the real hardware. Each core has its own caches, and cores, compilers and the JIT all <b>reorder</b> memory operations. The <b>Java Memory Model</b> says when a write by one thread is guaranteed to be visible to another: <b>happens-before</b>, built from <code>volatile</code>, locks, thread start/join and <code>final</code> fields.',
    fact: 'Without happens-before, a thread may <i>never</i> see another thread’s write. Not late: never.',
    links: [
      ['Ch. 16 — The three enemies of visibility', P5 + '16-java-memory-model.html#the-three-enemies-of-visibility'],
      ['Ch. 16 — Happens-before', P5 + '16-java-memory-model.html#happens-before-rules'],
    ],
  },
  ram: {
    area: 'beyond',
    title: 'Main memory',
    see: 'The long board under the heap is main memory; everything above ultimately lives here.',
    summary:
      'The heap, Metaspace, code cache, thread stacks and direct buffers all end up here. The JVM’s footprint is <b>much more</b> than <code>-Xmx</code>, which matters a lot in containers.',
    fact: 'The JVM reads the container’s cgroup limits: use <code>-XX:MaxRAMPercentage</code> rather than hard-coding <code>-Xmx</code>.',
    links: [
      ['Ch. 11 — Running in containers', P3 + '11-gc-tuning.html#running-in-containers'],
      ['Ch. 6 — Putting it all together', P2 + '06-runtime-data-areas.html#putting-it-all-together-memory-of-a-running-scala-app'],
    ],
  },
  native: {
    area: 'beyond',
    title: 'The portal to native code',
    see: 'The pink portal in the dome wall. Pink particles flow out to native libraries floating outside the JVM.',
    summary:
      'Through here the JVM talks to C libraries, the OS and hardware. The old way is <b>JNI</b> (C glue code by hand); the modern way is the <b>FFM API</b> (Java 22): describe the C function in Java, get a <code>MethodHandle</code>, call it. No C compiler needed.',
    fact: 'Since JDK 24, native access prints a warning unless enabled with <code>--enable-native-access</code>: integrity by default.',
    links: [
      ['Ch. 24 — The FFM API', P7 + '24-native-interop.html#the-ffm-api-the-modern-way-java-22'],
      ['Ch. 24 — JNI', P7 + '24-native-interop.html#jni-the-old-way'],
    ],
  },
  jfr: {
    area: 'beyond',
    title: 'Java Flight Recorder',
    see: 'The little drone with a blinking red light circling the dome. The panel in the top-right corner shows what it is recording.',
    summary:
      'The little drone circling the JVM is <b>JFR</b>: a black box built into HotSpot that records GC pauses, allocations, locks, JIT activity and much more, at around 1% overhead. Safe to leave on in production.',
    extra: '<pre class="snip">jcmd &lt;pid&gt; JFR.start duration=60s filename=app.jfr</pre>',
    fact: 'The numbers in the top-right corner of this page are a (pretend) live JFR feed of this world.',
    links: [
      ['Ch. 21 — Java Flight Recorder', P6 + '21-monitoring.html#java-flight-recorder-jfr'],
      ['Ch. 21 — jcmd', P6 + '21-monitoring.html#jcmd-the-swiss-army-knife'],
    ],
  },
} satisfies Record<string, Hotspot>;

export type HotspotId = keyof typeof HOTSPOTS;

// The guided tour: follow a program from source file to running machine code.
export const TOUR: TourStep[] = [
  { id: 'jvm', say: 'Welcome inside a running JVM. Let’s follow a program from its source code to machine code.' },
  { id: 'source', say: 'It all starts outside, with source code the JVM will never see.' },
  { id: 'compiler', say: 'The compiler turns it into bytecode.' },
  { id: 'classfile', say: 'Bytecode travels in class files, starting with 0xCAFEBABE.' },
  { id: 'classloaders', say: 'Crossing the boundary: class loaders bring classes in, lazily.' },
  { id: 'verifier', say: 'Nothing runs before it is verified and linked.' },
  { id: 'metaspace', say: 'The class’s metadata settles in Metaspace.' },
  { id: 'interpreter', say: 'Execution starts in the interpreter, one instruction at a time.' },
  { id: 'c1', say: 'Warm methods get compiled by C1, with profiling.' },
  { id: 'c2', say: 'Hot ones get the full C2 treatment.' },
  { id: 'codecache', say: 'The machine code lands in the code cache.' },
  { id: 'threads', say: 'Threads run all this code, frame by frame.' },
  { id: 'eden', say: 'Their allocations fill Eden with fresh objects…' },
  { id: 'object', say: '…each one a small header plus its fields.' },
  { id: 'gc', say: 'When Eden is full, the garbage collector steps in.', action: 'gcNow' },
  { id: 'vthreads', say: 'Virtual threads multiplex millions of tasks onto a few carriers.' },
  { id: 'cpu', say: 'Below it all: real cores, real caches, and the memory model.' },
  { id: 'native', say: 'And at the edge, a portal to native code.' },
  { id: 'jfr', say: 'All the while, the flight recorder is watching. Now explore on your own!' },
];
