import * as Base64 from '@borderless/base64';
import * as Core from '@polycentric/polycentric-core';
import * as React from 'react';
import * as ReactRouterDOM from 'react-router-dom';
import * as Profile from './Profile';

type MainPageProps = {
  processHandle: Core.ProcessHandle.ProcessHandle;
  queryManager: Core.Queries.QueryManager.QueryManager;
};

const decodeSystemQuery = (raw: string) => {
  return Core.Models.URLInfo.getSystemLink(
    Core.Protocol.URLInfo.decode(Base64.decode(raw)),
  );
};

export function MainPage(props: MainPageProps) {
  const { system: systemQuery } = ReactRouterDOM.useParams<{
    system: string;
  }>();

  const [system, setSystem] = React.useState<
    Core.Models.URLInfoSystemLink.URLInfoSystemLink | undefined
  >();

  React.useEffect(() => {
    if (systemQuery) {
      try {
        const decodedSystemQuery = decodeSystemQuery(systemQuery);

        for (const server of decodedSystemQuery.servers) {
          props.processHandle.addAddressHint(decodedSystemQuery.system, server);
        }

        setSystem(decodedSystemQuery);
      } catch (_) {
        setSystem(undefined);
      }
    } else {
      setSystem(undefined);
    }
  }, [systemQuery, props.processHandle]);

  return (
    <div className="flex flex-col items-center bg-gray min-h-screen dark:bg-zinc-900">
      <img src="/logo.svg" className="w-20 mt-11" />
      {system ? (
        <Profile.Profile
          processHandle={props.processHandle}
          queryManager={props.queryManager}
          system={system.system}
        />
      ) : (
        <h1>Failed to decode URL</h1>
      )}
    </div>
  );
}

type AppProps = {
  processHandle: Core.ProcessHandle.ProcessHandle;
  queryManager: Core.Queries.QueryManager.QueryManager;
};

export function App(props: AppProps) {
  const Routes = () => (
    <ReactRouterDOM.Switch>
      <ReactRouterDOM.Route path="/:system">
        <MainPage
          processHandle={props.processHandle}
          queryManager={props.queryManager}
        />
      </ReactRouterDOM.Route>
    </ReactRouterDOM.Switch>
  );

  return (
    <ReactRouterDOM.BrowserRouter>
      <Routes />
    </ReactRouterDOM.BrowserRouter>
  );
}
