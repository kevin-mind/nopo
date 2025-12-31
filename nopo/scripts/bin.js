#!/usr/bin/env node

import("./build/index.js")
  .then(({ default: main }) => {
    main();
  })
  .catch((error) => {
    console.error({ error });
    process.exit(1);
  });
