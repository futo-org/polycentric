import * as ReactDOM from 'react-dom/client';

import '@polycentric/polycentric-react/dist/style.css';
import * as PolycentricReact from '@polycentric/polycentric-react';
import { createPersistenceDriverLevelDB } from '@polycentric/polycentric-leveldb';

const persistenceDriver = createPersistenceDriverLevelDB('./polystate');

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <PolycentricReact.App persistenceDriver={persistenceDriver} />,
);
