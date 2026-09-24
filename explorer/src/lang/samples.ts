// Ready-to-run programs for the Code Lab, each chosen to make one part of the
// JVM light up in the 3D world.

export interface Sample {
  id: string;
  title: string;
  blurb: string;
  /** What to watch in the 3D world while it runs. */
  watch: string;
  code: string;
}

const code = (s: string) => s.replace(/^\n/, '').replace(/\n\s*$/, '\n');

export const SAMPLES: readonly Sample[] = [
  {
    id: 'stack',
    title: 'A stack machine',
    blurb: 'Two ints, a bit of arithmetic. Every operation pops its operands from the operand stack and pushes its result.',
    watch: 'the operand stack and the local variables, instruction by instruction',
    code: code(`
class Main {
  public static void main(String[] args) {
    int a = 6;
    int b = 7;
    // load a, load b, multiply, store: a stack machine at work
    int answer = a * b;
    int shifted = (answer + 8) / 5 - a;
    System.out.println("answer = " + answer);
    System.out.println("shifted = " + shifted);
  }
}
`),
  },
  {
    id: 'fib',
    title: 'Recursion',
    blurb: 'The classic recursive Fibonacci: every call pushes a new frame on the thread stack, every return pops it.',
    watch: 'your thread tower growing and shrinking with each call',
    code: code(`
class Main {
  static int fib(int n) {
    if (n < 2) return n;
    return fib(n - 1) + fib(n - 2);
  }

  public static void main(String[] args) {
    System.out.println("fib(15) = " + fib(15));
  }
}
`),
  },
  {
    id: 'hot',
    title: 'Warm up the JIT',
    blurb: 'A tiny method called twenty thousand times. It starts interpreted, gets warm, then hot.',
    watch: 'square() turning green (C1) then orange (C2) as the JIT compiles it, and the run speeding up',
    code: code(`
class Main {
  static int square(int x) {
    return x * x;
  }

  public static void main(String[] args) {
    int sum = 0;
    for (int i = 0; i < 20000; i++) {
      sum += square(i % 100);
    }
    System.out.println("sum = " + sum);
  }
}
`),
  },
  {
    id: 'garbage',
    title: 'Garbage everywhere',
    blurb: 'Thousands of short-lived Point records: each one is garbage as soon as its loop iteration ends.',
    watch: 'Eden filling with your objects, and the GC reclaiming almost all of them',
    code: code(`
record Point(int x, int y) {
  int dist2() {
    return x * x + y * y;
  }
}

class Main {
  public static void main(String[] args) {
    int inside = 0;
    for (int i = 0; i < 3000; i++) {
      // Garbage as soon as this iteration ends
      Point p = new Point(i % 97 - 48, i % 89 - 44);
      if (p.dist2() < 48 * 48) inside++;
    }
    System.out.println(inside + " points inside the circle");
  }
}
`),
  },
  {
    id: 'survivors',
    title: 'Objects that survive',
    blurb: 'A linked list stays reachable from main while scratch arrays die young.',
    watch: 'your Node objects surviving collections: copied to Survivor, then promoted to Old',
    code: code(`
class Node {
  int value;
  Node next;

  Node(int value, Node next) {
    this.value = value;
    this.next = next;
  }
}

class Main {
  public static void main(String[] args) {
    Node head = null;
    for (int i = 1; i <= 400; i++) {
      head = new Node(i, head);      // reachable from head: survives
      int[] scratch = new int[8];    // garbage at the next iteration
      scratch[0] = i;
    }
    int sum = 0;
    int length = 0;
    for (Node n = head; n != null; n = n.next) {
      sum += n.value;
      length++;
    }
    System.out.println(length + " nodes, sum = " + sum);
  }
}
`),
  },
  {
    id: 'sort',
    title: 'Arrays',
    blurb: 'Fill an int[] with pseudo-random numbers, then bubble sort it.',
    watch: 'iaload and iastore in the bytecode, and the loops (backward jumps) counting towards the JIT',
    code: code(`
class Main {
  public static void main(String[] args) {
    int[] a = new int[30];
    int seed = 42;
    for (int i = 0; i < a.length; i++) {
      seed = (seed * 75 + 74) % 65537;   // a tiny random generator
      a[i] = seed % 1000;
    }
    for (int i = 0; i < a.length; i++) {
      for (int j = 0; j < a.length - 1 - i; j++) {
        if (a[j] > a[j + 1]) {
          int t = a[j];
          a[j] = a[j + 1];
          a[j + 1] = t;
        }
      }
    }
    System.out.println("smallest = " + a[0] + ", largest = " + a[a.length - 1]);
  }
}
`),
  },
  {
    id: 'overflow',
    title: 'StackOverflowError',
    blurb: 'A recursive method with no base case. The stack can only grow so far.',
    watch: 'your thread tower climbing to the ceiling of the dome, then the crash',
    code: code(`
class Main {
  static int depth(int n) {
    return depth(n + 1) + 1;   // no base case!
  }

  public static void main(String[] args) {
    System.out.println(depth(0));
  }
}
`),
  },
  {
    id: 'oops',
    title: 'Division by zero',
    blurb: 'A countdown that ends badly: integer division by zero throws an ArithmeticException.',
    watch: 'the last iteration, and the exception unwinding the thread',
    code: code(`
class Main {
  public static void main(String[] args) {
    int total = 1000;
    for (int i = 5; i >= 0; i--) {
      total = total / i;   // i reaches 0...
      System.out.println("i = " + i + ", total = " + total);
    }
  }
}
`),
  },
];
