"use client";
import {useEffect,useRef} from 'react';
import type {ReactNode} from 'react';
export function ShiftExchangeDialog({title,description,pending,onClose,children}:{title:string;description:string;pending:boolean;onClose:()=>void;children:ReactNode}){
 const dialog=useRef<HTMLDialogElement>(null),close=useRef<HTMLButtonElement>(null);
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null,overflow=document.body.style.overflow;document.body.style.overflow='hidden';dialog.current?.showModal();close.current?.focus();return()=>{document.body.style.overflow=overflow;const target=previous&&previous!==document.body&&previous.isConnected?previous:document.querySelector<HTMLElement>('[data-exchange-focus],button[aria-label="Notifications"]');target?.focus();};},[]);
 return <dialog ref={dialog} className="schedule-tools-dialog exchange-dialog" aria-labelledby="exchange-dialog-title" onCancel={event=>{event.preventDefault();if(!pending)onClose();}}>
  <header><div><h2 id="exchange-dialog-title">{title}</h2><p>{description}</p></div><button ref={close} type="button" className="icon-button" aria-label="Close shift request dialog" disabled={pending} onClick={onClose}>×</button></header>
  <div className="schedule-tools-content">{children}</div>
 </dialog>;
}
