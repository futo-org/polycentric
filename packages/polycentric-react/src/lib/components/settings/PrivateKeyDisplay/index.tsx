/**
 * @fileoverview Private key display component with copy functionality.
 */

import { encode } from '@borderless/base64';
import { useCallback, useRef, useState } from 'react';
import { useProcessHandleManager } from '../../../hooks/processHandleManagerHooks';

// Private key display with text selection and copy functionality
export const PrivateKeyDisplay = () => {
  const { processHandle } = useProcessHandleManager();
  const [copied, setCopied] = useState(false);
  const privateKeyRef = useRef<HTMLPreElement>(null);

  const privateKeyString = encode(processHandle.processSecret().system.key);

  const highlightText = useCallback(() => {
    if (privateKeyRef.current) {
      const range = document.createRange();
      range.selectNodeContents(privateKeyRef.current);

      privateKeyRef.current.style.userSelect = 'auto';

      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
  }, []);

  const copyPrivateKey = useCallback(() => {
    if (privateKeyString) {
      // highlight the text
      highlightText();

      // copy the text
      navigator.clipboard.writeText(privateKeyString);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [privateKeyString, highlightText]);

  return (
    <div className="flex border rounded-full overflow-hidden flex-col md:flex-row md:items-start md:bg-gray-50">
      <div className="flex-grow overflow-hidden md:flex md:flex-col">
        <pre
          className="p-3 pl-6 font-mono whitespace-nowrap bg-white"
          onMouseUp={() => {
            highlightText();
          }}
          ref={privateKeyRef}
        >
          {privateKeyString}
        </pre>
      </div>

      <div className="flex-shrink-0 text-center border-t md:border-t-0">
        <button
          className="border-l p-3 px-5 flex-shrink-0 bg-gray-100"
          onClick={copyPrivateKey}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
};
