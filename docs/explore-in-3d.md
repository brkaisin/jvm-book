# Explore the JVM in 3D

Reading about the JVM is one thing. Walking around inside one is another.

The **3D explorer** is a small, living JVM you can fly through. Classes cross the class loaders and settle in Metaspace, threads push and pop stack frames, the JIT promotes hot methods from the interpreter to C1 and C2, objects pile up in Eden, and every few seconds the garbage collector sweeps the heap. Click anything to get a short explanation, live numbers, and a link to the chapter that covers it in depth.

<div class="explorer-embed">
  <iframe src="explorer/index.html?embed" title="The JVM in 3D (preview)" loading="lazy" allow="fullscreen"></iframe>
</div>

<p class="explorer-cta"><a href="explorer/index.html">Enter the JVM in 3D →</a></p>

A few things to try once you are inside:

- **Take the guided tour**: nineteen stops, from a `.scala` file on the outside to machine code in the code cache.
- **Press <kbd>G</kbd>** to trigger a collection and watch the application threads freeze at a safepoint, then **press <kbd>Z</kbd>** to switch to ZGC and trigger another one: the threads keep running.
- **Click a small cube in the heap**: a beam links the object to its class in Metaspace, and the panel shows its size and GC age.
- **Look under the floor**: the real hardware is down there, with one core per thread.
- Keep an eye on the flight-recorder panel and the event feed: C1 and C2 compilations, deoptimisations, GC pauses and class loads are logged as they happen.

> [!NOTE]
> The explorer is a teaching model, not a real JVM: sizes, timings and counts are scaled so that you can see things happen. The mechanisms (regions, tiers, safepoints, mounting and unmounting) behave the way the book describes them. It needs a browser with WebGL 2, and works best on a desktop.
