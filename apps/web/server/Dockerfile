# The site is built inside the image, so what ships is what the image built — there is no
# locally built dist/ to be one edit behind (.gcloudignore excludes it from the context).
FROM node:24-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.app.json tsconfig.node.json svelte.config.js vite.config.ts index.html ./
COPY public ./public
COPY src ./src

RUN npm run build

# Nothing from the build survives but dist/. The server is TypeScript that node runs as
# it is, and it imports only node: builtins, so the runtime image is node plus two files.
FROM node:24-alpine
WORKDIR /app
COPY server ./server
COPY --from=builder /app/dist ./static
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server/index.ts"]
