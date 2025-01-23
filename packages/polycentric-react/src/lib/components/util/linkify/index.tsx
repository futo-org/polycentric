import { Models, Protocol } from '@polycentric/polycentric-core';
import React, { forwardRef, useEffect, useMemo } from 'react';
import { useProcessHandleManager } from '../../../hooks/processHandleManagerHooks';
import {
    useQueryCRDTSet,
    useSystemLink,
    useUsernameCRDTQuery,
} from '../../../hooks/queryHooks';
import { Link } from '../link';

// match URLs that don't start with a slash
const urlRegex =
    /(?:^|[^\/])(?<url>(?:http|ftp|https):\/\/(?:[\w_-]+(?:(?:\.[\w_-]+)+))(?:[\w.,@?^=%&:\/~+#-]*[\w@?^=%&\/~+#-]))/gi;
const topicRegex = /(?:^|\s)(?<topic>\/\S+)/gi;
const mentionRegex = /@(?<mention>CAESI[A-Za-z0-9]+)/g;

type LinkifyType = 'url' | 'topic' | 'mention';
interface LinkifyItem {
    type: LinkifyType;
    value: string;
    start: number;
}

const linkify = (
    content: string,
    regex: RegExp,
    key: LinkifyType,
): LinkifyItem[] => {
    const matches = [...content.matchAll(regex)];
    return matches.map((match) => ({
        type: key,
        value: match.groups?.[key] ?? '',
        start:
            (match.index ?? 0) +
            (key === 'mention' ? 1 : match[0].indexOf(match[1])),
    }));
};

interface SuggestionPopup {
    query: string;
    position: { top: number; left: number };
    onSelect: (username: string) => void;
}

export const MentionSuggestions = ({
    query,
    position,
    onSelect,
}: SuggestionPopup) => {
    const { processHandle } = useProcessHandleManager();

    const [follows, advance] = useQueryCRDTSet(
        processHandle?.system(),
        Models.ContentType.ContentTypeFollow,
    );

    useEffect(() => {
        advance();
    }, [advance]);

    // Transform follows into systems
    const systems = useMemo(
        () =>
            follows
                ?.filter((f) => f.lwwElementSet?.value)
                .map((f) =>
                    Models.PublicKey.fromProto(
                        Protocol.PublicKey.decode(f.lwwElementSet!.value),
                    ),
                )
                .filter((system) => {
                    const systemId = Models.PublicKey.toString(system);
                    const lowerQuery = query.toLowerCase();
                    return (
                        !query || systemId.toLowerCase().includes(lowerQuery)
                    );
                })
                .slice(0, 5) ?? [],
        [follows, query],
    );

    if (!systems.length) return null;

    return (
        <div
            className="fixed z-50 bg-white shadow-lg rounded-md p-2 min-w-[200px]"
            style={{
                top: position.top,
                left: position.left,
                maxHeight: '200px',
                overflowY: 'auto',
            }}
        >
            {systems.map((system) => (
                <MentionSuggestionItem
                    key={Models.PublicKey.toString(system)}
                    system={system}
                    onSelect={onSelect}
                    query={query}
                />
            ))}
        </div>
    );
};

const MentionSuggestionItem = ({
    system,
    onSelect,
    query,
}: {
    system: Models.PublicKey.PublicKey;
    onSelect: (username: string) => void;
    query: string;
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
            className="cursor-pointer hover:bg-gray-100 p-2 rounded flex flex-col"
            onClick={() => onSelect(systemId)}
        >
            <span className="font-medium">{username || systemId}</span>
            {username && username !== systemId && (
                <span className="text-sm text-gray-500">{systemId}</span>
            )}
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
        const publicKey = useMemo(
            () =>
                Models.PublicKey.fromString(
                    value as Models.PublicKey.PublicKeyString,
                ),
            [value],
        );
        const profileLink = useSystemLink(publicKey);

        if (!profileLink) return <span>{value}</span>;

        return (
            <span className="pointer-events-auto relative z-50">
                <Link
                    routerLink={profileLink}
                    onClick={(e) => {
                        if (stopPropagation) e.stopPropagation();
                    }}
                    className="!text-blue-600 !hover:underline !cursor-pointer"
                >
                    {value}
                </Link>
            </span>
        );
    },
    (prevProps, nextProps) => prevProps.value === nextProps.value,
);

MentionLink.displayName = 'MentionLink';

export const Linkify = React.memo(
    forwardRef<
        HTMLDivElement,
        {
            as: React.ElementType;
            className: string;
            content: string;
            stopPropagation?: boolean;
            onContentChange?: (newContent: string) => void;
        }
    >(({ as, className, content, stopPropagation }, ref) => {
        const jsx = useMemo(() => {
            const foundUrls = linkify(content, urlRegex, 'url');
            const foundTopics = linkify(content, topicRegex, 'topic');
            const foundMentions = linkify(content, mentionRegex, 'mention');

            const items = [...foundUrls, ...foundTopics, ...foundMentions].sort(
                (a, b) => a.start - b.start,
            );

            const out = [];
            let i = 0;
            for (const item of items) {
                if (i < item.start) out.push(content.substring(i, item.start));
                if (item.type === 'url') {
                    out.push(
                        <a
                            href={item.value}
                            className="text-blue-500 hover:underline"
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) =>
                                stopPropagation && e.stopPropagation()
                            }
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
                }
                i = item.start + item.value.length;
            }
            out.push(content.substring(i));
            return out;
        }, [content, stopPropagation]);

        const Component = useMemo(() => as, [as]);

        return (
            <Component className={`${className} relative`} ref={ref}>
                {jsx}
            </Component>
        );
    }),
    (prevProps, nextProps) =>
        prevProps.content === nextProps.content &&
        prevProps.className === nextProps.className &&
        prevProps.stopPropagation === nextProps.stopPropagation,
);

Linkify.displayName = 'Linkify';
