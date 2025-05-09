# Nopo

## Scripts

Build the image

```bash
make build
```

Run the project

```bash
make up
```

## Todo

- [ ] add storybook
- [X] make the app a workspace (encapsulate the source and configs)
- [X] create database service (postgres)
- [X] create ui package
- [X] add vitest
- [X] add github actions for CI
- [X] setup deployment on fly.io
- [X] add codespaces support
- [ ] add version endpoint and UI badge
- [ ] add health check in deployment to verify deployed
- [ ] add smoketest via playwright
- [ ] add post deploy push of latest image and release document
- [ ] add PR deployment
- [ ] add deployment link to PR
- [ ] add release link to PR and parent issue

## Tests

- test the config
- test the build
- test development hot mode works
- test production serves optimized assets
