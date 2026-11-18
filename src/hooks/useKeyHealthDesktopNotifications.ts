import {useEffect,useRef} from 'react';
import {useNavigate} from 'react-router';
import {useDesktopPreference} from './useDesktopNotifications';
import {keyPopupPlans,type ApiKeyHealthRow} from '../lib/keyHealthView';
import {readSeen,writeSeen} from '../lib/jobs/seen';
const storage=()=>{try{return window.localStorage;}catch{return null;}};

/** Reuse the existing opt-in; never ask for permission or show member notifications. */
export function useKeyHealthDesktopNotifications(rows:ApiKeyHealthRow[],loading:boolean,orgId:string|null,admin:boolean) {
  const {enabled,permission,userId,setEnabled}=useDesktopPreference();const navigate=useNavigate();
  const scope=orgId&&userId?`key-health:${userId}:${orgId}`:null;
  const history=useRef<{scope:string|null;seen:Set<string>}>({scope:null,seen:new Set()});const opened=useRef(new Set<Notification>());
  useEffect(()=>{const current=opened.current;return()=>{current.forEach(notification=>{notification.onclick=null;notification.close();});current.clear();};},[scope,admin]);
  useEffect(()=>{
    if(history.current.scope!==scope)history.current={scope,seen:scope?readSeen(storage(),scope):new Set()};
    if(loading||!scope)return;
    for(const popup of keyPopupPlans(rows,{admin,enabled,permission,seen:history.current.seen})){
      try{const notification=new Notification(popup.title,{body:popup.body,tag:`key-health:${popup.key}`,silent:true});
        notification.onclick=()=>{window.focus();navigate(popup.href);notification.close();};notification.onclose=()=>opened.current.delete(notification);
        opened.current.add(notification);history.current.seen.add(popup.key);writeSeen(storage(),scope,history.current.seen);
      }catch{console.error('api_key_health_notification_unavailable');setEnabled(false);break;}
    }
  },[rows,loading,scope,admin,enabled,permission,navigate,setEnabled]);
}
