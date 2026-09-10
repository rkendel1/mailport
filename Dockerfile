FROM node:22-alpine AS build
WORKDIR /opt/mailport
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node packages ./packages
COPY --chown=node:node scripts ./scripts
RUN npm ci && npm run build --workspaces

FROM node:22-alpine AS runtime
WORKDIR /opt/mailport
ENV NODE_ENV=production
RUN mkdir -p node_modules/@mailerport
COPY --from=build /opt/mailport/packages/core/package.json ./node_modules/@mailerport/core/package.json
COPY --from=build /opt/mailport/packages/core/dist ./node_modules/@mailerport/core/dist
COPY --from=build /opt/mailport/packages/mime/package.json ./node_modules/@mailerport/mime/package.json
COPY --from=build /opt/mailport/packages/mime/dist ./node_modules/@mailerport/mime/dist
COPY --from=build /opt/mailport/packages/smtp/package.json ./node_modules/@mailerport/smtp/package.json
COPY --from=build /opt/mailport/packages/smtp/dist ./node_modules/@mailerport/smtp/dist
COPY --from=build /opt/mailport/packages/service/package.json ./node_modules/@mailerport/service/package.json
COPY --from=build /opt/mailport/packages/service/dist ./node_modules/@mailerport/service/dist
COPY --from=build /opt/mailport/packages/service/bin ./node_modules/@mailerport/service/bin
USER node
EXPOSE 8789
CMD ["node", "node_modules/@mailerport/service/bin/mailport-service.js"]
