VERSION=$(git rev-parse HEAD)

echo $VERSION

cat <<EOT > packages/polycentric-core/src/version.ts
export const SHA="${VERSION}";
EOT

cat <<EOT > server/src/version.rs 
pub const VERSION: &str = "${VERSION}";
EOT
