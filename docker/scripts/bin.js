#!/usr/bin/env node

import("./build/index.js")
  .then(({ default: main }) => {
    main(process.argv, process.env);
  })
  .catch((error) => {
    console.error({ error });
    process.exit(1);
  });
