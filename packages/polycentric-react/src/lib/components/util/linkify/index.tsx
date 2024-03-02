import 'linkify-plugin-hashtag';
import * as linkify from 'linkifyjs';
import { forwardRef, useMemo } from 'react';
import { Link } from '../link';

export const Linkify = forwardRef(
    (
        {
            as,
            className,
            content,
        }: {
            as: React.ElementType;
            className: string;
            ref: React.Ref<HTMLDivElement>;
            content: string;
        },
        ref,
    ) => {
        const jsx = useMemo(() => {
            const foundItems = linkify.find(content);
            const desiredItems = ['url', 'hashtag'];

            const filteredItems = foundItems.filter((item) =>
                desiredItems.includes(item.type),
            );

            const out = [];
            let i = 0;
            for (const item of filteredItems) {
                if (i < item.start) out.push(content.substring(i, item.start));
                if (item.type === 'url') {
                    out.push(
                        <a
                            href={item.href}
                            className="text-blue-500 hover:underline"
                            target="_blank"
                            // Currently we don't say that links are coming from polycentric - should this change?
                            rel="noreferrer"
                        >
                            {item.value}
                        </a>,
                    );
                } else if (item.type === 'hashtag') {
                    const itemWithoutStartingOctothorpe = item.value.replace(
                        /^#/,
                        '',
                    );
                    out.push(
                        <Link
                            routerLink={`/t/-${itemWithoutStartingOctothorpe}`}
                            className="text-blue-500 hover:underline"
                            routerDirection="forward"
                        >
                            {item.value}
                        </Link>,
                    );
                }
                i = item.end;
            }
            out.push(content.substring(i));

            return out;
        }, [content]);

        const Component = useMemo(() => as, [as]);
        return (
            <Component className={className} ref={ref}>
                {jsx}
            </Component>
        );
    },
);

Linkify.displayName = 'Linkify';
