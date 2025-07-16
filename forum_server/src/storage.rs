use axum::body::Bytes;
use std::path::{Path, PathBuf};
use tokio::fs;
use uuid::Uuid;

#[derive(Clone)]
pub struct LocalImageStorage {
    pub upload_dir: PathBuf,
    pub base_url: String,
}

impl LocalImageStorage {
    pub fn new(upload_dir: String, base_url: String) -> Self {
        Self {
            upload_dir: PathBuf::from(upload_dir),
            base_url,
        }
    }

    pub async fn save_image(
        &self,
        file_bytes: Bytes,
        original_filename: Option<String>,
    ) -> Result<String, std::io::Error> {
        let extension = original_filename
            .and_then(|name| {
                Path::new(&name)
                    .extension()
                    .and_then(|os_str| os_str.to_str())
                    .map(|s| s.to_owned())
            })
            .map(|ext| format!(".{}", ext))
            .unwrap_or_default();

        let unique_filename = format!("{}{}", Uuid::new_v4(), extension);
        let file_path = self.upload_dir.join(&unique_filename);

        fs::create_dir_all(&self.upload_dir).await?;

        fs::write(&file_path, file_bytes).await?;

        let upload_url_prefix = "/uploads/images";
        let url_path = format!("{}/{}", upload_url_prefix, unique_filename);

        Ok(url_path)
    }

    pub async fn delete_image(&self, image_url: &str) -> Result<(), std::io::Error> {
        let path = Path::new(image_url);
        let path = path.strip_prefix(&self.base_url).unwrap_or(path);
        let file_path = self.upload_dir.join(path);
        fs::remove_file(&file_path).await?;
        Ok(())
    }
}
