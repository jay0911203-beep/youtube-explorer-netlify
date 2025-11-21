import React, { useState, useEffect } from 'react';
import { Search, Play, Settings, X, Loader2, Youtube, AlertCircle, User, Calendar, Eye, FileText, ChevronLeft, Download, Copy, Github, RefreshCw, Globe, ShieldCheck } from 'lucide-react';

export default function App() {
  const [apiKey, setApiKey] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [query, setQuery] = useState('');
  const [viewMode, setViewMode] = useState('search'); 
  const [channels, setChannels] = useState([]);
  const [loading, setLoading] = useState(false);
  const [channelVideos, setChannelVideos] = useState([]);
  const [selectedChannel, setSelectedChannel] = useState(null);
  const [nextPageToken, setNextPageToken] = useState(null);
  
  const [transcriptModal, setTranscriptModal] = useState({ 
    isOpen: false, videoId: null, title: '', content: '', loading: false, status: '' 
  });

  // --- 설정 로드 ---
  useEffect(() => {
    const k = localStorage.getItem('yt_api_key');
    if(k) setApiKey(k); else setShowSettings(true);
  }, []);

  useEffect(() => { if(apiKey) localStorage.setItem('yt_api_key', apiKey); }, [apiKey]);

  const decodeHtml = (h) => { try { const t = document.createElement("textarea"); t.innerHTML = h; return t.value; } catch(e){return h;} };

  // --- YouTube Data API ---
  const searchChannels = async (e) => {
    e.preventDefault(); if(!query.trim()) return; setLoading(true); setViewMode('search');
    try {
      const res = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&maxResults=12&q=${encodeURIComponent(query)}&type=channel&key=${apiKey}`);
      const data = await res.json(); setChannels(data.items||[]);
    } catch(e){} finally { setLoading(false); }
  };

  const handleChannelClick = async (cid, ctitle) => {
    setLoading(true);
    try {
      const res = await fetch(`https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${cid}&key=${apiKey}`);
      const data = await res.json();
      if(data.items?.[0]) {
        const uid = data.items[0].contentDetails.relatedPlaylists.uploads;
        setSelectedChannel({id:cid, title:ctitle, uploadsId:uid});
        const vRes = await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=12&playlistId=${uid}&key=${apiKey}`);
        const vData = await vRes.json();
        setNextPageToken(vData.nextPageToken);
        setChannelVideos(vData.items||[]);
        setViewMode('videos');
      }
    } catch(e){} finally { setLoading(false); }
  };

  const loadMore = async () => {
    if(!selectedChannel || !nextPageToken) return;
    try {
      const res = await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=12&playlistId=${selectedChannel.uploadsId}&pageToken=${nextPageToken}&key=${apiKey}`);
      const data = await res.json();
      setNextPageToken(data.nextPageToken);
      setChannelVideos(prev => [...prev, ...data.items]);
    } catch(e){}
  };

  // =================================================================
  // [핵심] Direct Transcript Parser (CORS Proxy 사용)
  // Piped API 의존성을 제거하고, 유튜브 원본 데이터를 직접 해석합니다.
  // =================================================================
  const fetchDirectTranscript = async (videoId, updateStatus) => {
    const PROXY_URL = 'https://corsproxy.io/?'; // 강력한 CORS 우회 프록시
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

    try {
      updateStatus('유튜브 페이지 데이터 분석 중...');
      
      // 1. 유튜브 영상 페이지 HTML 가져오기
      const response = await fetch(`${PROXY_URL}${encodeURIComponent(videoUrl)}`);
      const html = await response.text();

      // 2. 플레이어 초기 데이터(ytInitialPlayerResponse) 추출
      // 이 데이터 안에 자막 트랙 정보가 숨겨져 있습니다.
      const match = html.match(/var ytInitialPlayerResponse = ({.*?});/s);
      if (!match) throw new Error("플레이어 데이터를 찾을 수 없습니다.");

      const playerResponse = JSON.parse(match[1]);
      const tracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

      if (!tracks || tracks.length === 0) {
        throw new Error("이 영상에는 자막이 없습니다.");
      }

      // 3. 자막 트랙 선택 (한국어 -> 영어 -> 첫 번째)
      const track = tracks.find(t => t.languageCode === 'ko') || 
                    tracks.find(t => t.languageCode === 'en') || 
                    tracks[0];

      updateStatus(`자막 다운로드 중 (${track.name.simpleText})...`);

      // 4. 실제 자막 XML 데이터 가져오기
      const xmlUrl = `${PROXY_URL}${encodeURIComponent(track.baseUrl)}`;
      const xmlResponse = await fetch(xmlUrl);
      const xmlText = await xmlResponse.text();

      // 5. XML 태그 제거 및 텍스트 정제
      const cleanText = xmlText
        .replace(/<text.*?>(.*?)<\/text>/g, '$1 ') // 태그 내용 추출
        .replace(/<[^>]+>/g, '') // 나머지 태그 제거
        .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&') // HTML 엔티티 복원
        .replace(/\s+/g, ' ') // 공백 정리
        .trim();

      return { text: cleanText, lang: track.languageCode };

    } catch (error) {
      throw error;
    }
  };

  // 자막 요청 메인 함수 (Hybrid Strategy)
  const getTranscript = async (title, videoId) => {
    setTranscriptModal({ isOpen: true, videoId, title, content: '', loading: true, status: '서버 요청 중...' });
    
    try {
      // 1차 시도: Netlify Server Function
      try {
        const res = await fetch(`/.netlify/functions/transcript?videoId=${videoId}`);
        if (res.ok) {
          const data = await res.json();
          if (data.success) {
            setTranscriptModal(p => ({...p, loading: false, content: data.transcript, status: `성공 (Server: ${data.lang})`}));
            return;
          }
        }
        throw new Error('Server Failed');
      } catch (serverErr) {
        console.log("Server failed, switching to direct parser...");
      }

      // 2차 시도: Direct Browser Parser (Fallback)
      // 서버가 500이거나 실패하면 브라우저가 직접 유튜브를 분석합니다.
      const result = await fetchDirectTranscript(videoId, (msg) => setTranscriptModal(p => ({...p, status: msg})));
      
      setTranscriptModal(p => ({...p, loading: false, content: result.text, status: `성공 (Direct: ${result.lang})`}));

    } catch (err) {
      setTranscriptModal(p => ({...p, loading: false, content: `실패: ${err.message}`, status: '실패'}));
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 font-sans text-gray-900">
      <header className="bg-white shadow-sm sticky top-0 z-20 h-16 flex items-center px-4 gap-4">
        <div className="flex items-center gap-2 text-red-600 font-bold text-lg cursor-pointer" onClick={() => window.location.reload()}>
          <Youtube fill="currentColor"/> Explorer
        </div>
        <div className="flex-1"></div>
        <button onClick={() => setShowSettings(!showSettings)} className="p-2 hover:bg-gray-100 rounded-full"><Settings size={24}/></button>
      </header>

      {showSettings && (
        <div className="bg-gray-800 p-4 text-white flex justify-center"><div className="flex gap-2 w-full max-w-2xl"><input className="text-black flex-1 p-2 rounded" value={apiKey} onChange={e=>setApiKey(e.target.value)} placeholder="YouTube API Key"/><button onClick={()=>setShowSettings(false)} className="bg-yellow-600 px-4 rounded">닫기</button></div></div>
      )}

      {transcriptModal.isOpen && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl h-[70vh] flex flex-col">
            <div className="p-4 border-b flex justify-between items-center">
              <h3 className="font-bold truncate pr-4">{transcriptModal.title}</h3>
              <button onClick={()=>setTranscriptModal(p=>({...p, isOpen:false}))}><X/></button>
            </div>
            <div className="flex-1 p-4 overflow-auto relative">
              {transcriptModal.loading ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-white">
                  <Loader2 className="animate-spin text-red-600 mb-2" size={32}/>
                  <p className="text-sm text-gray-500">{transcriptModal.status}</p>
                </div>
              ) : (
                <>
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">{transcriptModal.content}</p>
                  <div className="text-xs text-right text-green-600 mt-4 flex justify-end items-center gap-1"><ShieldCheck size={12}/> {transcriptModal.status}</div>
                </>
              )}
            </div>
            <div className="p-4 border-t text-right">
              <button onClick={() => navigator.clipboard.writeText(transcriptModal.content)} className="px-4 py-2 bg-gray-900 text-white rounded text-sm flex items-center gap-2 ml-auto"><Copy size={14}/> 복사하기</button>
            </div>
          </div>
        </div>
      )}

      <main className="max-w-7xl mx-auto p-4">
        {!apiKey && <div className="text-center py-10 text-gray-500">설정에서 API 키를 입력해주세요.</div>}
        {apiKey && (
          <>
            <form onSubmit={searchChannels} className="flex gap-2 max-w-lg mx-auto mb-8"><input value={query} onChange={e=>setQuery(e.target.value)} className="flex-1 p-3 rounded-full border shadow-sm" placeholder="채널 검색"/><button className="bg-red-600 text-white px-6 rounded-full">검색</button></form>
            {loading && <div className="flex justify-center py-10"><Loader2 className="animate-spin text-red-600" size={40}/></div>}
            {viewMode === 'search' && !loading && <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">{channels.map(c => (<div key={c.id.channelId} onClick={()=>handleChannelClick(c.id.channelId, decodeHtml(c.snippet.title))} className="bg-white p-4 rounded-xl shadow cursor-pointer hover:shadow-lg text-center"><img src={c.snippet.thumbnails.medium.url} className="w-20 h-20 rounded-full mx-auto mb-2"/><h3 className="font-bold line-clamp-1">{decodeHtml(c.snippet.title)}</h3></div>))}</div>}
            {viewMode === 'videos' && !loading && <div><button onClick={()=>setViewMode('search')} className="mb-4 flex items-center gap-1 text-sm font-bold"><ChevronLeft size={16}/> 뒤로가기</button><div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">{channelVideos.map(v => (<div key={v.id} className="bg-white rounded-xl shadow overflow-hidden"><div className="aspect-video bg-gray-200 relative"><img src={v.snippet.thumbnails.medium?.url} className="w-full h-full object-cover"/><div className="absolute inset-0 flex items-center justify-center bg-black/10 opacity-0 hover:opacity-100 transition-opacity"><Play className="text-white" fill="white"/></div></div><div className="p-3"><h3 className="font-bold text-sm line-clamp-2 mb-3 h-10">{decodeHtml(v.snippet.title)}</h3><button onClick={()=>getTranscript(decodeHtml(v.snippet.title), v.snippet.resourceId.videoId)} className="w-full py-2 bg-blue-50 text-blue-600 rounded text-xs font-bold hover:bg-blue-100 flex items-center justify-center gap-1"><Globe size={12}/> 자막 추출</button></div></div>))}</div>{nextPageToken && <div className="text-center mt-6"><button onClick={loadMore} className="px-6 py-2 bg-white border rounded-full text-sm">더 보기</button></div>}</div>}
          </>
        )}
      </main>
    </div>
  );
}