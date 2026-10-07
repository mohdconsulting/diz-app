import { handlers, start } from './app';

Object.assign(window, handlers);
start();
