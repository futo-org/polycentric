import { Models } from '@polycentric/polycentric-core';
import { Virtuoso } from 'react-virtuoso';
import { useAvatar } from '../../../hooks/imageHooks';
import {
    useDescriptionCRDTQuery,
    useSystemLink,
    useUsernameCRDTQuery,
} from '../../../hooks/queryHooks';
import { Link } from '../../util/link';
import { Modal } from '../../util/modal';
import { ProfilePicture } from '../ProfilePicture';

const AccountListItem = ({
    system,
    onClick,
}: {
    system: Models.PublicKey.PublicKey;
    onClick?: () => void;
}) => {
    const avatarURL = useAvatar(system);
    const name = useUsernameCRDTQuery(system);
    const description = useDescriptionCRDTQuery(system);
    const link = useSystemLink(system);

    return (
        <div className="flex flex-col items-center" onClick={onClick}>
            <Link
                routerLink={link}
                className="flex flex-row items-center justify-between w-full p-2 hover:bg-gray-50 border border-transparent hover:border-inherit rounded-[3.5rem] overflow-hidden"
            >
                <div className="flex flex-row items-center w-full">
                    <ProfilePicture
                        src={avatarURL}
                        alt={name}
                        className="w-12 h-12 rounded-full"
                    />
                    <div className="flex flex-col ml-2 flex-shrink min-w-0">
                        <span className="text-sm font-semibold text-gray-800 overflow-hidden text-ellipsis whitespace-nowrap">
                            {name}
                        </span>
                        <span className="text-xs font-normal text-gray-500 overflow-hidden text-ellipsis whitespace-nowrap">
                            {description}
                        </span>
                    </div>
                </div>
            </Link>
            <div className="w-[calc(100%-3.5rem-2px)] -my-[1px] border-b"></div>
        </div>
    );
};

export const AccountList = ({
    systems,
    advance,
    onItemClick,
}: {
    systems: Array<Models.PublicKey.PublicKey>;
    advance: () => void;
    onItemClick?: (index: number) => void;
}) => {
    return (
        <Virtuoso
            data={systems}
            endReached={advance}
            itemContent={(index) => (
                <AccountListItem
                    system={systems[index]}
                    key={Models.PublicKey.toString(systems[index])}
                    onClick={() => onItemClick?.(index)}
                />
            )}
        />
    );
};

export const AccountListModal = ({
    title,
    systems,
    advance,
    setOpen,
    open,
}: {
    title: string;
    systems: Array<Models.PublicKey.PublicKey>;
    advance: () => void;
    setOpen: (open: boolean) => void;
    open: boolean;
}) => {
    return (
        <Modal title={title} open={open} setOpen={setOpen} shrink={false}>
            <div className="w-full h-full md:w-96 md:max-w-full md:h-80 md:max-h-full">
                <AccountList
                    systems={systems}
                    advance={advance}
                    onItemClick={() => setOpen(false)}
                />
            </div>
        </Modal>
    );
};
