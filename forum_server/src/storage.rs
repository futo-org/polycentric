use std::path::{Path, PathBuf};
use axum::body::Bytes;
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

    /// Saves image bytes to a unique filename in the upload directory.
    /// Returns the publicly accessible URL path.
    pub async fn save_image(&self, file_bytes: Bytes, original_filename: Option<String>) -> Result<String, std::io::Error> {
        // Generate a unique filename using UUID + original extension
        let extension = original_filename
            .and_then(|name| {
                Path::new(&name)
                    .extension()
                    .and_then(|os_str| os_str.to_str())
                    .map(|s| s.to_owned())
            })
            .map(|ext| format!(".{}", ext))
            .unwrap_or_else(|| "".to_string());

        let unique_filename = format!("{}{}", Uuid::new_v4(), extension);
        let file_path = self.upload_dir.join(&unique_filename);

        // Ensure the directory exists (though main.rs already does this)
        fs::create_dir_all(&self.upload_dir).await?;
        
        // Write the file
        fs::write(&file_path, file_bytes).await?;

        // Construct the URL path
        let url_path = format!("{}/{}", self.base_url, unique_filename);
        
        Ok(url_path)
    }
    
    // Optional: Add a delete method if needed later
    // pub async fn delete_image(&self, image_url: &str) -> Result<(), std::io::Error> { ... }
} 