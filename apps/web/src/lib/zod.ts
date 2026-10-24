/** The one way into zod for the pad: its JIT off before the first schema is built.
 *
 *  The JIT compiles each schema with `new Function`, and probes for it the first time an
 *  object schema is made — interview-prep's VS Code host logged an error on every start
 *  until every schema came from an entry like this one. Lint refuses any other import of
 *  zod (.oxlintrc.json), so no schema can be built before this line has run. */
import * as z from 'zod';

z.config({ jitless: true });

export { z };
