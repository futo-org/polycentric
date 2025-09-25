/**
 * @fileoverview Video embedding component with platform-specific players and third-party consent.
 */

import { Fragment, useMemo, useState } from 'react';
import {
  lbryURIRegex,
  mp4URLRegex,
  vimeoURLRegex,
  youtubeURLRegex,
} from '../platformRegex';

// Generic iframe embed component for video platforms
const IframeEmbed = ({
  src,
  ...rest
}: { src: string } & React.IframeHTMLAttributes<HTMLIFrameElement>) => {
  return (
    <iframe
      width="100%"
      height="auto"
      className="aspect-video"
      src={src}
      allowFullScreen
      {...rest}
    />
  );
};

// YouTube-specific embed with privacy controls
const YoutubeEmbed = ({ id }: { id: string }) => {
  return (
    <IframeEmbed
      src={`https://www.youtube.com/embed/${id}`}
      title="YouTube video player"
      allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
    />
  );
};

// Direct video embed for MP4 files
const VideoEmbed = ({
  src,
  ...rest
}: { src: string } & React.VideoHTMLAttributes<HTMLVideoElement>) => {
  return <video className="aspect-video" src={src} controls {...rest} />;
};

// Third-party consent container with privacy policy acceptance
const TopFeedVideoContainer = ({
  children,
  platformName,
}: {
  children: React.ReactNode;
  platformName: string;
}) => {
  const [acceptedThirdParty, setAcceptedThirdParty] = useState(false);
  return (
    <div
      className={`aspect-video w-full  border-b ${
        acceptedThirdParty ? 'sticky top-0 z-50' : ''
      }`}
    >
      {acceptedThirdParty ? (
        children
      ) : (
        <>
          <div className="p-10 h-full flex flex-col justify-center items-center space-y-3">
            <h3 className="max-w-[30rem]">
              {`This video is hosted on ${platformName}. By clicking play, you agree to ${platformName}'s privacy policy and sending them data.`}
            </h3>
            <button
              onClick={() => setAcceptedThirdParty(true)}
              className="px-3 py-2 border rounded-full hover:bg-gray-50"
            >
              Accept
            </button>
          </div>
        </>
      )}
    </div>
  );
};
/*! lbry code (C) 2023 
    https://github.com/OdyseeTeam/odysee-frontend/blob/4c6114a466d45b24b3dc7686e8f352fa52594de6/ui/util/web.js#L5
    MIT License
*/
function escapeHtmlProperty(property: string) {
  return property
    ? String(property)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;')
    : '';
}
const getLbryEmbedUrl = (uri: string) => {
  const uriPath = uri.replace('lbry://', '').replace(/#/g, ':');
  const encodedUri = encodeURIComponent(uriPath)
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29');
  return `https://lbry.tv/$/embed/${escapeHtmlProperty(encodedUri)}`;
};

// Main video component with platform detection and appropriate player selection
export const TopFeedVideo = ({ topic }: { topic: string }) => {
  const { player, platformName } = useMemo(() => {
    let player: React.ReactNode | undefined = <></>;
    let platformName: string | undefined = undefined;

    switch (true) {
      case youtubeURLRegex.test(topic):
        const youtubeMatch = topic.match(youtubeURLRegex);
        if (youtubeMatch) {
          const id = youtubeMatch[1];
          player = <YoutubeEmbed id={id} />;
          platformName = 'YouTube';
        }
        break;
      case lbryURIRegex.test(topic):
        const embedUrl = getLbryEmbedUrl(topic);
        player = <IframeEmbed src={embedUrl} />;
        platformName = 'LBRY';
        break;
      case vimeoURLRegex.test(topic):
        const vimeoMatch = topic.match(vimeoURLRegex);
        if (vimeoMatch) {
          const id = vimeoMatch[1];
          player = <IframeEmbed src={`https://player.vimeo.com/video/${id}`} />;
          platformName = 'Vimeo';
        }
        break;
      // Not supporting rumble until they have an easy way to get the embed id from the video URL
      case mp4URLRegex.test(topic):
        const mp4Match = topic.match(mp4URLRegex);
        if (mp4Match) {
          const url = mp4Match[0];
          player = <VideoEmbed src={url} />;
          platformName = 'the direct video URL';
        }
        break;
      default:
        break;
    }

    return { player, platformName };
  }, [topic]);

  if (player && platformName) {
    return (
      <TopFeedVideoContainer platformName={platformName}>
        {player}
      </TopFeedVideoContainer>
    );
  }

  return <Fragment />;
};
