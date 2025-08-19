FROM node:22-alpine

WORKDIR /usr/src/app

COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm && pnpm install

COPY . .

RUN pnpm build

ENV PORT=3000
EXPOSE $PORT

CMD ["sh", "-c", "node dist/index.js"]
