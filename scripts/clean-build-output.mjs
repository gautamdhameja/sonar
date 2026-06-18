import { rmSync } from "node:fs";

for (const path of ["dist"]) {
  rmSync(path, { force: true, recursive: true });
}
