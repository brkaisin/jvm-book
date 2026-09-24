# Explore the JVM in 3D

Reading about the JVM is one thing. Walking around inside one is another.

The **3D explorer** is a small, living JVM you can fly through. Classes cross the class loaders and settle in Metaspace, threads push and pop stack frames, the JIT promotes hot methods from the interpreter to C1 and C2, objects pile up in Eden, and every few seconds the garbage collector sweeps the heap. Click anything to get a short explanation, live numbers, and a link to the chapter that covers it in depth.

<div class="explorer-embed">
  <iframe src="explorer/index.html?embed" title="The JVM in 3D (preview)" loading="lazy" allow="fullscreen"></iframe>
</div>

<p class="explorer-cta"><a href="explorer/index.html">Enter the JVM in 3D →</a></p>

A few things to try once you are inside:

- **Take the guided tour**: nineteen stops, from a `.scala` file on the outside to machine code in the code cache. A narrator explains each stop (it uses the most natural voice your browser offers; pick another one from the subtitles, or turn the voice or the sound off from the bottom bar if you prefer silence).
- **Click things, they react**: the garbage collector collects, the heap allocates a burst of objects, the class loaders load a new class, the interpreter makes a method hot, C2 breaks a speculation, the portal calls a C function, the flight recorder dumps a recording.
- **Open the Code Lab** (<kbd>C</kbd>): write a small Java program, or pick one of the examples, and watch it run on this JVM. It is compiled to real bytecode, executed one instruction at a time (the operand stack and the locals are shown live), its calls stack up on a gold thread tower, its objects land in Eden and are collected only once your program can no longer reach them, and its hot methods get compiled by the JIT and visibly speed up. Try the `StackOverflowError` example.
- **Press <kbd>G</kbd>** to trigger a collection and watch the application threads freeze at a safepoint, then **press <kbd>Z</kbd>** to switch to ZGC and trigger another one: the threads keep running.
- **Press <kbd>K</kbd>** for the legend: what every colour, stream and spark means.
- **Look under the floor**: the real hardware is down there, with one core per thread.

> [!NOTE]
> The explorer is a teaching model, not a real JVM: sizes, timings and counts are scaled so that you can see things happen. The mechanisms (regions, tiers, safepoints, mounting and unmounting) behave the way the book describes them. It needs a browser with WebGL 2, and works best on a desktop.
