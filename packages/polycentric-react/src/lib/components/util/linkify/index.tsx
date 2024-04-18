import { forwardRef, useMemo } from 'react';
import { Link } from '../link';

// match URLs that don't start with a slash
const urlRegex =
    /(?:^|[^\/])(?<url>(?:http|ftp|https):\/\/(?:[\w_-]+(?:(?:\.[\w_-]+)+))(?:[\w.,@?^=%&:\/~+#-]*[\w@?^=%&\/~+#-]))/gi;
const topicRegex = /(?:^|\s)(?<topic>\/\S+)/gi;

type LinkifyType = 'url' | 'topic';
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
    return [...content.matchAll(regex)].map((match) => {
        return {
            type: key,
            value: match.groups?.[key] ?? '',
            start: (match.index ?? 0) + match[0].indexOf(match[1]),
        };
    });
};

export const Linkify = forwardRef(
    (
        {
            as,
            className,
            content,
            stopPropagation,
        }: {
            as: React.ElementType;
            className: string;
            ref: React.Ref<HTMLDivElement>;
            content: string;
            stopPropagation?: boolean;
        },
        ref,
    ) => {
        const jsx = useMemo(() => {
            const foundUrls = linkify(content, urlRegex, 'url');
            const foundTopics = linkify(content, topicRegex, 'topic');

            const items = [...foundUrls, ...foundTopics].sort(
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
                            // Currently we don't say that links are coming from polycentric - should this change?
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
                }
                i = item.start + item.value.length;
            }
            out.push(content.substring(i));

            return out;
        }, [content, stopPropagation]);

        const Component = useMemo(() => as, [as]);
        return (
            <Component className={className} ref={ref}>
                {jsx}
            </Component>
        );
    },
);

Linkify.displayName = 'Linkify';
