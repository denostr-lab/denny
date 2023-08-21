## Builder
FROM node:18.12.1-alpine3.15 as builder

WORKDIR /src

COPY .npmrc package.json yarn.lock /src/
RUN yarn install --frozen-lockfile
COPY . /src/
RUN NODE_OPTIONS=--max-old-space-size=8192 yarn build


## App
FROM nginx:1.25.2-alpine

COPY --from=builder /src/dist /app

RUN rm -rf /usr/share/nginx/html \
  && ln -s /app /usr/share/nginx/html
