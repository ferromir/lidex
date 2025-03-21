# Lidex

![Build and test](https://github.com/ferromir/lidex/actions/workflows/build-and-test.yml/badge.svg)

Lidex is a lightweight durable execution library who allows you to write and execute workflows.

## Features
* Lightweight - No addition services or required. Your Node.js app can start workflows and also execute them.
* Scalable - Scale horizontally by adding simply more instances of your service so you can process more workflows.
* Powered by MongoDB - Workflow state is stored in MongoDB. If your application already uses MongoDB you don't even have to an additional database to your infrastructure.
* Minimalistic - It adds a minimal of features to implement a realiable durable execution solution. The resulting package is ~42kB only.
* Typed - Written in TypeScript, types provided in the package.

## Install
```bash
npm install lidex
```