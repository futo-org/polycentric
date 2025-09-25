/**
 * @fileoverview Footer links component with external links.
 */

// Footer links for bug reports, source code, and privacy policy
export const FooterLinks = () => {
  return (
    <div className="p-5 w-full text-right text-gray-400 text-sm">
      <a
        href="mailto:polycentric@futo.org"
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
