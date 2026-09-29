// Browser entry: exposes the library as a global `Syrup` for plain <script> use.
import * as syrup from "../src/index";

(globalThis as { Syrup?: typeof syrup }).Syrup = syrup;
