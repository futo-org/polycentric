import * as ReactRouterDOM from 'react-router-dom';
import * as React from 'react';

import * as Core from '@polycentric/polycentric-core';
import * as Util from './util';

function loadVouchedByState(
  cancelContext: Core.CancelContext.CancelContext,
  processHandle: Core.ProcessHandle.ProcessHandle,
  queryManager: Core.Queries.QueryManager.QueryManager,
  system: Core.Models.PublicKey.PublicKey,
  setProps: (f: (state: VouchedByState) => VouchedByState) => void,
): Core.Queries.Shared.UnregisterCallback {
  const queries: Array<Core.Queries.Shared.UnregisterCallback> = [];

  queries.push(
    queryManager.queryCRDT.query(
      system,
      Core.Models.ContentType.ContentTypeUsername,
      (value) => {
        if (!cancelContext.cancelled()) {
          setProps((state) => {
            return {
              ...state,
              username: value.value ? Core.Util.decodeText(value.value) : '',
            };
          });
        }
      },
    ),
  );

  (async () => {
    const link = await Core.ProcessHandle.makeSystemLink(processHandle, system);

    if (cancelContext.cancelled()) {
      return;
    }

    console.log('setting link');

    setProps((state) => {
      return {
        ...state,
        link: link,
      };
    });
  })();

  return () => {
    queries.forEach((f) => f());
  };
}

export type VouchedByProps = {
  processHandle: Core.ProcessHandle.ProcessHandle;
  queryManager: Core.Queries.QueryManager.QueryManager;
  system: Core.Models.PublicKey.PublicKey;
};

export type VouchedByState = {
  username: string;
  link: string;
};

function makeInitialState(
  system: Core.Models.PublicKey.PublicKey,
): VouchedByState {
  return {
    username: '',
    link: Core.ProcessHandle.makeSystemLinkSync(system, []),
  };
}

export function VouchedBy(props: VouchedByProps) {
  const avatar = Util.useAvatar(props.queryManager, props.system);

  const [state, setState] = React.useState<VouchedByState>(
    makeInitialState(props.system),
  );

  React.useEffect(() => {
    setState(makeInitialState(props.system));

    const cancelContext = new Core.CancelContext.CancelContext();

    const cleanupView = loadVouchedByState(
      cancelContext,
      props.processHandle,
      props.queryManager,
      props.system,
      setState,
    );

    return () => {
      cancelContext.cancel();

      cleanupView();
    };
  }, [props.system, props.queryManager, props.processHandle]);

  return (
    <div>
      <ReactRouterDOM.Link to={'/' + state.link}>
        <img
          src={avatar}
          alt={state.username}
          className="border rounded-full w-20 h-20"
        />
      </ReactRouterDOM.Link>
    </div>
  );
}
