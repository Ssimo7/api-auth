import fs from 'fs';
import path from 'path';
import helmet from 'helmet';
import express from 'express';
import session from 'express-session';
import Provider from 'oidc-provider';
import connectRedis from 'connect-redis';
import morgan from 'morgan';

import adapter from './connectors/oidc-persistance-redis-adapter';
import { getNewRedisClient } from './connectors/redis';
import {
  provider as providerConfiguration,
  cookiesMaxAge,
  cookiesSecrets,
} from './configuration';
import { keys } from './keystore';
import routes from './routes';
import { getClients } from './services/oidc-clients';

const { PORT = 3000, ISSUER = `http://localhost:${PORT}` } = process.env;
const RedisStore = connectRedis(session);

const app = express();

app.use(helmet());
app.use(
  helmet.contentSecurityPolicy({
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", 'stats.data.gouv.fr'],
      scriptSrc: ["'self'", 'stats.data.gouv.fr'],
      styleSrc: ["'self'", 'unpkg.com'],
      fontSrc: ["'self'", 'unpkg.com'],
    },
  })
);

const logger = morgan('combined', {
  stream: fs.createWriteStream(
    process.env.ACCESS_LOG_PATH || './api-scopes.log',
    { flags: 'a' }
  ),
});
app.use(logger);

app.set('trust proxy', 1);

app.use(
  session({
    store: new RedisStore({
      client: getNewRedisClient(),
    }),
    secret: cookiesSecrets,
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: cookiesMaxAge, secure: true },
  })
);

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

app.use('/assets', express.static('public'));

const provider = new Provider(ISSUER, providerConfiguration);

let server;

(async () => {
  await provider.initialize({
    adapter,
    clients: await getClients(),
    keystore: { keys },
  });
  provider.proxy = true;

  routes(app, provider);
  app.use(provider.callback);
  server = app.listen(PORT, () => {
    console.log(`application is listening on port ${PORT}`);
  });
})().catch(err => {
  if (server && server.listening) server.close();
  console.error(err);
  process.exitCode = 1;
});
