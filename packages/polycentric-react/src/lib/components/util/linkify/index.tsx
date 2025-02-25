/* eslint-disable react/prop-types */
import { Models, Protocol } from '@polycentric/polycentric-core';
import React, { forwardRef, useEffect, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import { useProcessHandleManager } from '../../../hooks/processHandleManagerHooks';
import {
  useQueryCRDTSet,
  useSystemLink,
  useUsernameCRDTQuery,
} from '../../../hooks/queryHooks';
import { Link } from '../link';
import {
  linkify,
  mentionRegex,
  quoteRegex,
  topicRegex,
  urlRegex,
} from './utils';

interface SuggestionPopup {
  query: string;
  onSelect: (username: string) => void;
}

export const MentionSuggestions = ({ query, onSelect }: SuggestionPopup) => {
  const { processHandle } = useProcessHandleManager();
  const [selectedIndex, setSelectedIndex] = React.useState(0);

  const [follows, advance] = useQueryCRDTSet(
    processHandle?.system(),
    Models.ContentType.ContentTypeFollow,
  );

  useEffect(() => {
    advance();
  }, [advance]);

  // Transform follows into systems without filtering
  const systems = useMemo(
    () =>
      follows
        ?.filter((f) => f.lwwElementSet?.value)
        .map((f) =>
          Models.PublicKey.fromProto(
            Protocol.PublicKey.decode(
              f.lwwElementSet?.value ?? new Uint8Array(),
            ),
          ),
        ) ?? [],
    [follows],
  );

  // Reset selected index when query changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!systems.length) return;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev < systems.length - 1 ? prev + 1 : prev,
          );
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev));
          break;
        case 'Enter':
          e.preventDefault();
          const selectedSystem = systems[selectedIndex];
          if (selectedSystem) {
            onSelect(Models.PublicKey.toString(selectedSystem));
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [systems, selectedIndex, onSelect]);

  if (!systems.length) return null;

  return (
    <div
      className="bg-white shadow-lg rounded-md p-2 min-w-[200px]"
      style={{
        position: 'relative',
        maxHeight: '200px',
        overflowY: 'auto',
      }}
    >
      {systems.map((system, index) => (
        <MentionSuggestionItem
          key={Models.PublicKey.toString(system)}
          system={system}
          onSelect={onSelect}
          query={query}
          isSelected={index === selectedIndex}
        />
      ))}
    </div>
  );
};

const MentionSuggestionItem = ({
  system,
  onSelect,
  query,
  isSelected,
}: {
  system: Models.PublicKey.PublicKey;
  onSelect: (username: string) => void;
  query: string;
  isSelected: boolean;
}) => {
  const username = useUsernameCRDTQuery(system);
  const systemId = Models.PublicKey.toString(system);

  const shouldShow =
    !query ||
    username?.toLowerCase().includes(query.toLowerCase()) ||
    systemId.toLowerCase().includes(query.toLowerCase());

  if (!shouldShow) return null;

  return (
    <div
      className={`cursor-pointer p-2 rounded ${
        isSelected ? 'bg-gray-100' : 'hover:bg-gray-100'
      }`}
      onClick={() => onSelect(systemId)}
    >
      <span className="font-medium">{username || systemId}</span>
    </div>
  );
};

const MentionLink = React.memo(
  ({
    value,
    stopPropagation,
  }: {
    value: string;
    stopPropagation?: boolean;
  }) => {
    const publicKey = useMemo(() => {
      try {
        return Models.PublicKey.fromString(
          value as Models.PublicKey.PublicKeyString,
        );
      } catch {
        return null;
      }
    }, [value]);

    const profileLink = useSystemLink(
      publicKey || ({} as Models.PublicKey.PublicKey),
    );
    const username = useUsernameCRDTQuery(
      publicKey || ({} as Models.PublicKey.PublicKey),
    );

    if (!publicKey || !profileLink) return <span>{value}</span>;

    return (
      <span className="pointer-events-auto relative z-50">
        <Link
          routerLink={profileLink}
          onClick={(e) => {
            if (stopPropagation) e.stopPropagation();
          }}
          className="!text-blue-600 !hover:underline !cursor-pointer"
        >
          {username || value}
        </Link>
      </span>
    );
  },
  (prevProps, nextProps) => prevProps.value === nextProps.value,
);

MentionLink.displayName = 'MentionLink';

export interface LinkifyProps {
  as: React.ElementType;
  className: string;
  content: string;
  stopPropagation?: boolean;
  onContentChange?: (newContent: string) => void;
}

export const Linkify = React.memo(
  forwardRef<HTMLDivElement, LinkifyProps>(
    ({ as, className, content, stopPropagation }, ref) => {
      const jsx = useMemo(() => {
        const items = linkify(content, urlRegex, 'url')
          .concat(linkify(content, topicRegex, 'topic'))
          .concat(linkify(content, mentionRegex, 'mention'))
          .concat(linkify(content, quoteRegex, 'quote'))
          .sort((a, b) => a.start - b.start);

        const out = [];
        let lastIndex = 0;

        items.forEach((item) => {
          if (lastIndex < item.start) {
            out.push(
              <ReactMarkdown
                key={`md-${lastIndex}`}
                components={{
                  p: ({ children }) => <span>{children}</span>,
                }}
              >
                {content.substring(lastIndex, item.start)}
              </ReactMarkdown>,
            );
          }

          if (item.type === 'url') {
            out.push(
              <a
                href={item.value}
                className="text-blue-500 hover:underline"
                target="_blank"
                rel="noreferrer"
                onClick={(e) => stopPropagation && e.stopPropagation()}
                key={`${item.start}-${item.value}`}
              >
                {item.value}
              </a>,
            );
          } else if (item.type === 'topic') {
            out.push(
              <Link
                routerLink={`/t${item.value}`}
                className="text-purple-500 hover:underline"
                routerDirection="forward"
                stopPropagation={stopPropagation}
                key={`${item.start}-${item.value}`}
              >
                {item.value}
              </Link>,
            );
          } else if (item.type === 'mention') {
            out.push(
              <MentionLink
                key={`${item.start}-${item.value}`}
                value={item.value}
                stopPropagation={stopPropagation}
              />,
            );
          } else if (item.type === 'quote') {
            out.push(
              <span
                className="text-green-600 block"
                key={`${item.start}-${item.value}`}
              >
                {item.value}
              </span>,
            );
          }

          lastIndex = item.start + item.value.length;
        });

        if (lastIndex < content.length) {
          out.push(
            <ReactMarkdown
              key={`md-${lastIndex}`}
              components={{
                p: ({ children }) => <span>{children}</span>,
              }}
            >
              {content.substring(lastIndex)}
            </ReactMarkdown>,
          );
        }

        return out;
      }, [content, stopPropagation]);

      const Component = useMemo(() => as, [as]);

      return (
        <Component className={`${className} relative`} ref={ref}>
          {jsx}
        </Component>
      );
    },
  ),
);

Linkify.displayName = 'Linkify';
