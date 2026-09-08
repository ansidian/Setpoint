import { useEffect,useState } from 'react';
import { useNavigate } from 'react-router';
import { useWorkspaceLocation } from '../../context/WorkspaceLocationContext';
import { readDemoSafeLocalStorage,writeDemoSafeLocalStorage } from '../../demo/demoSafeLocalStorage';
import type { DashboardTab } from './dashboardShellModel';

/** Accepted locations preserve the shell behind foreground drafts and on Back. */
export default function useWorkspaceTabRoute(isMobile:boolean,demoMode:boolean) {
  const location=useWorkspaceLocation(),navigate=useNavigate();
  const settingsOpen=location.pathname==='/settings',financialOpen=location.pathname==='/finance';
  const [tab,setTab]=useState<DashboardTab>(()=>{
    if(location.pathname==='/finances')return 'finances';
    if(settingsOpen)return 'dashboard';
    const saved=readDemoSafeLocalStorage('ea:tab');
    return saved==='inbox'?'inbox':saved==='notes'&&!isMobile&&!demoMode?'notes':'dashboard';
  });
  const [tabs,setTabs]=useState(new Map<string,DashboardTab>());
  const [key,setKey]=useState(location.key);
  const [search,setSearch]=useState(location.pathname==='/finances'?location.search:'');
  const [mounted,setMounted]=useState(location.pathname==='/finances');
  if(key!==location.key){
    setTabs(new Map(tabs).set(key,tab));setKey(location.key);
    if(location.pathname==='/finances'){setTab('finances');setSearch(location.search);setMounted(true);}
    else if(location.pathname==='/')setTab(tabs.get(location.key)||location.state?.shellTab||'dashboard');
  }
  useEffect(()=>{writeDemoSafeLocalStorage('ea:tab',tab);},[tab]);
  return {search,mounted,tab,setTab,location,navigate,settingsOpen,financialOpen};
}
