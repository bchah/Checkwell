FROM node:16
COPY . .
COPY package*.json ./
RUN npm install
EXPOSE 80
CMD ["node", "main.js"]

