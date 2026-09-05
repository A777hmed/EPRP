export * from "./types";
export {
  clientService,
  projectTypeService,
  projectPhaseService,
  contactService,
  departmentService,
  systemService,
  disciplineService,
  jobTitleService,
  getMasterService,
  getClientById,
  getProjectTypeById,
  getProjectPhaseById,
  getContactById,
  getDepartmentById,
  getSystemById,
  getDisciplineById,
  getJobTitleById,
  MASTER_KIND_CONFIG,
} from "./services";
export { useMasterData } from "./use-master-data";
export { ManagedSelect, type ManagedSelectProps } from "./components/managed-select";
export {
  ManagedMultiSelect,
  type ManagedMultiSelectHandle,
  type ManagedMultiSelectProps,
} from "./components/managed-multi-select";
export {
  ManagedPersonSelect,
  type ManagedPersonSelectProps,
} from "./components/managed-person-select";
export {
  MasterDataDialog,
  ArchiveBadge,
  type MasterDataDialogProps,
} from "./components/master-data-dialog";
export {
  MasterRecordEditButton,
  type MasterRecordEditButtonProps,
} from "./components/master-record-edit-button";
export {
  MasterDataForm,
  type MasterDataFormProps,
} from "./components/master-data-form";
export {
  MasterDataTable,
  type MasterDataColumn,
  type MasterDataTableProps,
} from "./components/master-data-table";
export {
  MasterDataListView,
  type MasterDataListViewProps,
} from "./components/master-data-list-view";
export {
  MasterDataPageForm,
  type MasterDataPageFormProps,
} from "./components/master-data-page-form";
export {
  DepartmentDetailView,
  type DepartmentDetailViewProps,
} from "./components/department-detail-view";
export {
  SystemDetailView,
  type SystemDetailViewProps,
} from "./components/system-detail-view";
export {
  ContactDetailView,
  type ContactDetailViewProps,
} from "./components/contact-detail-view";
export {
  DisciplineDetailView,
  type DisciplineDetailViewProps,
} from "./components/discipline-detail-view";
export {
  ProjectReturnBar,
  type ProjectReturnBarProps,
} from "./components/project-return-bar";
export {
  DepartmentsListView,
  SystemsListView,
  DisciplinesListView,
  ContactsListView,
  JobTitlesListView,
} from "./components/master-data-views";
export {
  JobTitleDetailView,
  type JobTitleDetailViewProps,
} from "./components/job-title-detail-view";
export {
  ConfirmArchiveDialog,
  ConfirmRestoreDialog,
  ConfirmDeleteDialog,
  BlockedDeleteDialog,
} from "./components/confirm-dialogs";
export { useMasterDataActions } from "./components/use-master-data-actions";
