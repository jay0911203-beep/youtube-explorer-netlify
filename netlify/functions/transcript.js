
const { YoutubeTranscript } = require('youtube-transcript');

exports.handler = async function(event, context) {
  const { videoId } = event.queryStringParameters;
  
  // CORS 헤더 (모든 도메인 허용)
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTION',
  };

  if (!videoId) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Video ID required' }) };
  }

  try {
    // 1. 한국어 우선
    const transcript = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'ko' });
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, transcript: transcript.map(t => t.text).join(' '), lang: 'ko' })
    };
  } catch (error) {
    try {
      // 2. 영어 시도
      const transcript = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'en' });
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, transcript: transcript.map(t => t.text).join(' '), lang: 'en' })
      };
    } catch (err) {
      try {
        // 3. 자동 감지
        const transcript = await YoutubeTranscript.fetchTranscript(videoId);
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, transcript: transcript.map(t => t.text).join(' '), lang: 'auto' })
        };
      } catch (finalErr) {
        console.error(finalErr);
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ success: false, error: 'Server Blocked or No Captions' })
        };
      }
    }
  }
};
