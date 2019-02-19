FROM node:8.15
LABEL maintainer="bruianio@gmail.com"

WORKDIR /theApi
COPY ./package.json /theApi/
RUN npm config set registry http://registry.npmjs.org/ && npm install @babel/core @babel/cli -G
RUN npm install
COPY . /theApi/
EXPOSE 3000
CMD ["npm", "run", "start"]

