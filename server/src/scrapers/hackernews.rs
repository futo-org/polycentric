use ::warp::Reply;

const URL: &str = "https://hacker-news.firebaseio.com/v0";

pub(crate) async fn scrape(username: &str) -> ::anyhow::Result<()> {
    let body =
        reqwest::get(URL.to_owned() + "/user/" + username + "/about.json")
            .await?
            .text()
            .await?;

    println!("body = {:?}", body);

    Ok(())
}
