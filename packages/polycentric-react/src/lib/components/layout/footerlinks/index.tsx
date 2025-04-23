
export const FooterLinks = () => {
  return (
    <div className="p-5 w-full text-right text-gray-400 text-sm">
      <a
        href="mailto:bugs@polycentric.io"
        target="_blank"
        rel="noreferrer"
        className="block"
      >
        Report a Bug
      </a>
      <a
        href="https://gitlab.futo.org/polycentric/polycentric"
        target="_blank"
        rel="noreferrer"
        className="block"
      >
        Source Code
      </a>
      <a
        href="https://docs.polycentric.io/privacy-policy/"
        target="_blank"
        rel="noreferrer"
        className="block"
      >
        Privacy Policy
      </a>
    </div>
  );
}; 