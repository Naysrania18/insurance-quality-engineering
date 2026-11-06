FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm i --no-save tsx@4
COPY shared ./shared
COPY services ./services
COPY web ./web
COPY db ./db
ENV NODE_ENV=production
# SERVICE=quote|policy|claims, or run `web/main.ts` for the UI
CMD ["npx", "tsx", "services/main.ts"]
