#[derive(Clone, Debug)]
pub struct ForumServerConfig {
    pub name: String,
    pub image_url: Option<String>,
}

impl ForumServerConfig {
    pub fn new(name: String, image_url: Option<String>) -> Self {
        Self { name, image_url }
    }
}
