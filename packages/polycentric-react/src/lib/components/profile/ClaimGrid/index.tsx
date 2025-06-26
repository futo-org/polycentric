import { Models, Protocol } from '@polycentric/polycentric-core';
import Long from 'long';
import React, { useMemo, useState } from 'react';

import BitcoinIcon from '../../../../graphics/icons/rendered/bitcoin.svg.png';
import DailyMotionIcon from '../../../../graphics/icons/rendered/dailymotion.svg.png';
import DiscordIcon from '../../../../graphics/icons/rendered/discord.svg.png';
import SkillIcon from '../../../../graphics/icons/rendered/gear.svg.png';
import GitHubIcon from '../../../../graphics/icons/rendered/github.svg.png';
import GitlabIcon from '../../../../graphics/icons/rendered/gitlab.svg.png';
import HackerNewsIcon from '../../../../graphics/icons/rendered/hackernews.svg.png';
import InstagramIcon from '../../../../graphics/icons/rendered/instagram.svg.png';
import KickIcon from '../../../../graphics/icons/rendered/kick.svg.png';
import MindsIcon from '../../../../graphics/icons/rendered/minds.svg.png';
import NebulaIcon from '../../../../graphics/icons/rendered/nebula.svg.png';
import OdyseeIcon from '../../../../graphics/icons/rendered/odysee.svg.png';
import PatreonIcon from '../../../../graphics/icons/rendered/patreon.svg.png';
import PolycentricIcon from '../../../../graphics/icons/rendered/polycentric.svg.png';
import RumbleIcon from '../../../../graphics/icons/rendered/rumble.svg.png';
import SoundCloudIcon from '../../../../graphics/icons/rendered/soundcloud.svg.png';
import SpotifyIcon from '../../../../graphics/icons/rendered/spotify.svg.png';
import SpreadshopIcon from '../../../../graphics/icons/rendered/spreadshop.svg.png';
import SubstackIcon from '../../../../graphics/icons/rendered/substack.svg.png';
import TwitchIcon from '../../../../graphics/icons/rendered/twitch.svg.png';
import URLIcon from '../../../../graphics/icons/rendered/url.svg.png';
import VimeoIcon from '../../../../graphics/icons/rendered/vimeo.svg.png';
import WebsiteIcon from '../../../../graphics/icons/rendered/website.svg.png';
import WorkIcon from '../../../../graphics/icons/rendered/work.svg.png';
import TwitterIcon from '../../../../graphics/icons/rendered/x.svg.png';
import YouTubeIcon from '../../../../graphics/icons/rendered/youtube.svg.png';
import {
  useAvatar,
  useImageManifestDisplayURLs,
} from '../../../hooks/imageHooks';
import { useProcessHandleManager } from '../../../hooks/processHandleManagerHooks';
import {
  useClaimVouches,
  useSystemLink,
  useUsernameCRDTQuery,
} from '../../../hooks/queryHooks';
import { MakeClaim } from '../../claims/MakeClaim';
import { Modal } from '../../util/modal';
import { ClaimInfo } from './ClaimInfo';

const getIconFromClaimType = (
  type: Long,
): [React.ReactNode | undefined, string] => {
  switch (true) {
    case type.equals(Models.ClaimType.ClaimTypeHackerNews):
      return [
        <img
          key="hackernews"
          src={HackerNewsIcon}
          alt="Hacker News"
          className="w-6 h-6"
        />,
        '#ff6600',
      ];
    case type.equals(Models.ClaimType.ClaimTypeYouTube):
      return [
        <img
          key="youtube"
          src={YouTubeIcon}
          alt="YouTube"
          className="w-6 h-6"
        />,
        '#ff0000',
      ];
    case type.equals(Models.ClaimType.ClaimTypeOdysee):
      return [
        <img key="odysee" src={OdyseeIcon} alt="Odysee" className="w-6 h-6" />,
        '#cc0000',
      ];
    case type.equals(Models.ClaimType.ClaimTypeRumble):
      return [
        <img key="rumble" src={RumbleIcon} alt="Rumble" className="w-6 h-6" />,
        '#00ff00',
      ];
    case type.equals(Models.ClaimType.ClaimTypeTwitter):
      return [
        <img key="twitter" src={TwitterIcon} alt="X" className="w-6 h-6" />,
        '#1da1f2',
      ];
    case type.equals(Models.ClaimType.ClaimTypeBitcoin):
      return [
        <img
          key="bitcoin"
          src={BitcoinIcon}
          alt="Bitcoin"
          className="w-6 h-6"
        />,
        '#f7931a',
      ];
    case type.equals(Models.ClaimType.ClaimTypeGeneric):
      return [
        <span key="generic" className="text-sm">
          ?
        </span>,
        '#cccccc',
      ];
    case type.equals(Models.ClaimType.ClaimTypeDiscord):
      return [
        <img
          key="discord"
          src={DiscordIcon}
          alt="Discord"
          className="w-6 h-6"
        />,
        '#7289da',
      ];
    case type.equals(Models.ClaimType.ClaimTypeInstagram):
      return [
        <img
          key="instagram"
          src={InstagramIcon}
          alt="Instagram"
          className="w-6 h-6"
        />,
        '#e1306c',
      ];
    case type.equals(Models.ClaimType.ClaimTypeGitHub):
      return [
        <img key="github" src={GitHubIcon} alt="Github" className="w-6 h-6" />,
        '#333333',
      ];
    case type.equals(Models.ClaimType.ClaimTypeMinds):
      return [
        <img key="minds" src={MindsIcon} alt="Minds" className="w-6 h-6" />,
        '#fcd000',
      ];
    case type.equals(Models.ClaimType.ClaimTypePatreon):
      return [
        <img
          key="patreon"
          src={PatreonIcon}
          alt="Patreon"
          className="w-6 h-6"
        />,
        '#f96854',
      ];
    case type.equals(Models.ClaimType.ClaimTypeSubstack):
      return [
        <img
          key="substack"
          src={SubstackIcon}
          alt="Substack"
          className="w-6 h-6"
        />,
        '#ff6719',
      ];
    case type.equals(Models.ClaimType.ClaimTypeTwitch):
      return [
        <img key="twitch" src={TwitchIcon} alt="Twitch" className="w-6 h-6" />,
        '#6441a5',
      ];
    case type.equals(Models.ClaimType.ClaimTypeWebsite):
      return [
        <img
          key="website"
          src={WebsiteIcon}
          alt="Website"
          className="w-6 h-6"
        />,
        '#0000ff',
      ];
    case type.equals(Models.ClaimType.ClaimTypeKick):
      return [
        <img key="kick" src={KickIcon} alt="Kick" className="w-6 h-6" />,
        '#00ff00',
      ];
    case type.equals(Models.ClaimType.ClaimTypeSoundcloud):
      return [
        <img
          key="soundcloud"
          src={SoundCloudIcon}
          alt="Soundcloud"
          className="w-6 h-6"
        />,
        '#ff8800',
      ];
    case type.equals(Models.ClaimType.ClaimTypeVimeo):
      return [
        <img key="vimeo" src={VimeoIcon} alt="Vimeo" className="w-6 h-6" />,
        '#1ab7ea',
      ];
    case type.equals(Models.ClaimType.ClaimTypeNebula):
      return [
        <img key="nebula" src={NebulaIcon} alt="Nebula" className="w-6 h-6" />,
        '#0000ff',
      ];
    case type.equals(Models.ClaimType.ClaimTypeURL):
      return [
        <img key="url" src={URLIcon} alt="URL" className="w-6 h-6" />,
        '#0000ff',
      ];
    case type.equals(Models.ClaimType.ClaimTypeOccupation):
      return [
        <img key="occupation" src={WorkIcon} alt="Work" className="w-6 h-6" />,
        '#cccccc',
      ];
    case type.equals(Models.ClaimType.ClaimTypeSkill):
      return [
        <img key="skill" src={SkillIcon} alt="Skill" className="w-6 h-6" />,
        '#cccccc',
      ];
    case type.equals(Models.ClaimType.ClaimTypeSpotify):
      return [
        <img
          key="spotify"
          src={SpotifyIcon}
          alt="Spotify"
          className="w-6 h-6"
        />,
        '#1db954',
      ];
    case type.equals(Models.ClaimType.ClaimTypeSpreadshop):
      return [
        <img
          key="spreadshop"
          src={SpreadshopIcon}
          alt="Spreadshop"
          className="w-6 h-6"
        />,
        '#ffcc00',
      ];
    case type.equals(Models.ClaimType.ClaimTypePolycentric):
      return [
        <img
          key="polycentric"
          src={PolycentricIcon}
          alt="Polycentric"
          className="w-6 h-6"
        />,
        '#ffcc00',
      ];
    case type.equals(Models.ClaimType.ClaimTypeGitlab):
      return [
        <img key="gitlab" src={GitlabIcon} alt="Gitlab" className="w-6 h-6" />,
        '#fc6d26',
      ];
    case type.equals(Models.ClaimType.ClaimTypeDailymotion):
      return [
        <img
          key="dailymotion"
          src={DailyMotionIcon}
          alt="Dailymotion"
          className="w-6 h-6"
        />,
        '#0066dc',
      ];
    default:
      return [
        <span key="default" className="text-sm">
          ?
        </span>,
        '#cccccc',
      ];
  }
};

export const VouchedBy: React.FC<{ system: Models.PublicKey.PublicKey }> = ({
  system,
}) => {
  const avatar = useAvatar(system);
  const username = useUsernameCRDTQuery(system);
  const profileUrl = useSystemLink(system);

  // Limit username to first 3 characters + ellipsis if longer
  const displayName = username
    ? username.length > 3
      ? username.substring(0, 3) + '.'
      : username
    : '?';

  return (
    <a
      href={profileUrl}
      className="relative flex items-center justify-center w-10 h-10 hover:opacity-80 transition-opacity"
      title={username || 'View Profile'}
    >
      {/* Username centered over the avatar */}
      <div className="absolute inset-0 flex items-center justify-center text-xs text-white bg-black bg-opacity-50 rounded-full">
        {displayName}
      </div>
      {/* Avatar */}
      <img
        src={avatar}
        alt={username || 'User'}
        className="rounded-full w-full h-full border"
      />
    </a>
  );
};

const ClaimCircle: React.FC<{
  claim: Protocol.Claim;
  pointer: Protocol.Reference;
  process: Models.Process.Process;
  logicalClock: Long;
  position: 'start' | 'middle' | 'end';
  system: Models.PublicKey.PublicKey;
  isMyProfile?: boolean;
}> = ({
  claim,
  pointer,
  process,
  logicalClock,
  position,
  system,
  isMyProfile,
}) => {
  const { processHandle } = useProcessHandleManager();
  const images = useImageManifestDisplayURLs(system, claim.images);
  const [icon, color] = useMemo(
    () => getIconFromClaimType(claim.claimType),
    [claim.claimType],
  );

  const vouches = useClaimVouches(system, pointer);
  const [claimMenuOpen, setClaimMenuOpen] = useState(false);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setClaimMenuOpen(true);
  };

  return (
    <div
      className="relative"
      style={{
        zIndex: position === 'start' ? 1 : position === 'middle' ? 2 : 3,
      }}
    >
      <Modal
        open={claimMenuOpen}
        setOpen={setClaimMenuOpen}
        title={`${Models.ClaimType.toString(
          claim.claimType as Models.ClaimType.ClaimType,
        )} Claim`}
        shrink={false}
      >
        <ClaimInfo
          processHandle={processHandle}
          claim={claim}
          pointer={pointer}
          process={process}
          logicalClock={logicalClock}
          system={system}
          vouches={vouches}
          isMyProfile={isMyProfile}
        />
      </Modal>
      <div
        className={`rounded-full w-16 h-16 p-2 flex items-center justify-center transition-all duration-300 whitespace-nowrap overflow-hidden 
          ${position === 'start' ? 'left-0' : ''}`}
        style={{ backgroundColor: color }}
        onClick={handleClick}
      >
        {icon}
      </div>

      {/* Non-expanded vouch count */}
      {vouches?.length > 0 && (
        <div
          className="absolute bottom-0 right-0 w-6 h-6 bg-blue-500 text-white rounded-full flex items-center justify-center"
          title={`${vouches.length} vouches`}
        >
          {vouches.length}
        </div>
      )}
    </div>
  );
};

export const ClaimGrid: React.FC<{
  system: Models.PublicKey.PublicKey;
  claims: {
    value: Protocol.Claim;
    pointer: Protocol.Reference;
    process: Models.Process.Process;
    logicalClock: Long;
  }[];
  isMyProfile?: boolean;
}> = ({ system, claims, isMyProfile }) => {
  const [showClaimModal, setShowClaimModal] = useState(false);

  const claimsInGroupsOfThree = useMemo(() => {
    const out = [];
    for (let i = 0; i < claims.length; i += 3) {
      out.push(claims.slice(i, i + 3));
    }
    return out;
  }, [claims]);

  return (
    <div className="flex flex-col items-center justify-center space-y-3">
      <div className="text-center text-xl font-semibold">Claims</div>
      {isMyProfile && (
        <button
          onClick={() => setShowClaimModal(true)}
          className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50 focus:outline-none"
        >
          Make a Claim
        </button>
      )}
      <div className="w-full h-px bg-gray-300" />
      {showClaimModal && (
        <MakeClaim system={system} onClose={() => setShowClaimModal(false)} />
      )}
      {claimsInGroupsOfThree.length === 0 ? (
        <div className="text-center text-m text-gray-400">
          None at the moment...
        </div>
      ) : (
        claimsInGroupsOfThree.map((group, index) => (
          <div key={index} className="grid relative grid-cols-3 gap-4">
            {group.map((claim, index) => (
              <div
                key={claim.value.claimFields[0].value || index}
                className="w-16 h-16"
              >
                <ClaimCircle
                  claim={claim.value}
                  pointer={claim.pointer}
                  process={claim.process}
                  logicalClock={claim.logicalClock}
                  position={
                    index === 0 ? 'start' : index === 1 ? 'middle' : 'end'
                  }
                  system={system}
                  isMyProfile={isMyProfile}
                />
              </div>
            ))}
          </div>
        ))
      )}
    </div>
  );
};
