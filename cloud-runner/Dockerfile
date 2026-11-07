FROM node:24-alpine
WORKDIR /app
COPY cloud-runner/runtime ./runtime
COPY cloud-runner/runner.mjs ./runner.mjs
USER node
CMD ["node", "runner.mjs"]
