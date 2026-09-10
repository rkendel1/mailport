FROM node:22-alpine AS runtime
WORKDIR /opt/mailport
ENV NODE_ENV=production
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --chown=node:node bin ./bin
COPY --chown=node:node src ./src
USER node
EXPOSE 8789
CMD ["node", "bin/app.js", "mail", "service", "--host", "0.0.0.0"]
