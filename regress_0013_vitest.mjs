// Refuter (spec S0013) probe runner config: the repo's own vitest config only includes
// `test/**/*.test.ts`, and the refuter write-guard only permits `regress_*` filenames, so the
// probe/regress suites are selected here instead. Nothing about the repo's own gates is changed.
import { cosyteVitest } from "@cosyte/vitest-config";

export default cosyteVitest({
  coverageDirs: [],
  test: {
    globals: false,
    environment: "node",
    include: ["test/reverse/regress_0013_*.ts"],
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
