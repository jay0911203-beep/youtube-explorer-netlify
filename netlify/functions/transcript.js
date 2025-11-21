
const { YoutubeTranscript } = require('youtube-transcript');

exports.handler = async function(event, context) {
  const { videoId } = event.queryStringParameters;
  if (!videoId) return { statusCode: 400, body: JSON.stringify({ error: 'Video ID required' }) };

  try {
    const transcript = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'ko' });
    const text = transcript.map(t => t.text).join(' ');
    return { statusCode: 200, body: JSON.stringify({ success: true, transcript: text, lang: 'ko' }) };
  } catch (error) {
    try {
      const transcript = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'en' });
      const text = transcript.map(t => t.text).join(' ');
      return { statusCode: 200, body: JSON.stringify({ success: true, transcript: text, lang: 'en' }) };
    } catch (err) {
      return { statusCode: 500, body: JSON.stringify({ success: false, error: 'Failed' }) };
    }
  }
};
