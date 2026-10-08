import { toggleAuthMode, submitAuth, logout, saveProfile, saveAccountDetails } from './auth';
import { goTo } from './shell';
import { retrySharing, toggleTrackMap } from './tracking';
import { startPayment, mockPay, cancelMockCheckout } from './payments';
import {
  submitResponse, submitRequest, submitReport, submitOffer, submitCustomOffer, startReport, removePhoto,
  providerMarkDone, providerArrive, handlePhotoSelect, editJob, confirmDeleteRequest, completeJob, cancelReport,
  cancelDelete, assignJob, askDelete, useMyLocation, clearPin, setReportDraft, setRespondDraft,
} from './jobs';
import {
  setAdminFilter, saveAdminNote, adminDo, adminDeleteUser, adminAsk, adminAbort, setAdminQuery,
  setAdminNoteDraft, setAdminPendingUser,
} from './admin';

/** Functions referenced from inline on* attributes in the markup (module scope isn't visible to those). */
export const handlers = {
  goTo, toggleAuthMode, submitResponse, submitRequest, submitReport, submitOffer, submitCustomOffer, submitAuth,
  startReport, setAdminFilter, saveProfile, saveAdminNote, saveAccountDetails, removePhoto, providerMarkDone,
  providerArrive, logout, handlePhotoSelect, editJob, confirmDeleteRequest, completeJob, cancelReport, cancelDelete,
  assignJob, askDelete, useMyLocation, clearPin, adminDo, adminDeleteUser, adminAsk, adminAbort, setReportDraft, setRespondDraft,
  setAdminQuery, setAdminNoteDraft, setAdminPendingUser, startPayment, mockPay, cancelMockCheckout, retrySharing, toggleTrackMap,
};
