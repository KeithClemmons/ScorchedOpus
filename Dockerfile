FROM node:20-alpine
WORKDIR /app
COPY index.html package.json README.md ./
COPY js ./js
COPY dist ./dist
COPY server ./server
ENV PORT=8080
EXPOSE 8080
USER node
CMD ["node", "server/server.js"]
