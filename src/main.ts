import { handlers } from './handlers';
import { start } from './shell';

Object.assign(window, handlers);
start();
