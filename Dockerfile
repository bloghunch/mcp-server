FROM node:20-alpine
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY dist/ ./dist/

EXPOSE 3001

ENV TRANSPORT=http
ENV PORT=3001
ENV BLOGHUNCH_API_URL=https://api.bloghunch.com/api/v1

CMD ["node", "dist/index.js"]
